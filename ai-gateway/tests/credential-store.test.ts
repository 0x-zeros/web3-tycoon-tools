import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolveGatewayPaths } from "../src/util/home.js";
import {
  createEmptyCredentialStore,
  loadCredentialStore,
  parseCredentialStore,
  saveCredentialStore,
  summarizeCredentialStore,
} from "../src/auth/credential-store.js";
import {
  DEFAULT_PROFILE_ID,
  type CredentialSourceMode,
  type CredentialStore,
  type OAuthCredentialProfile,
} from "../src/auth/types.js";

async function tempHome(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "ai-gateway-credentials-"));
}

function sampleProfile(overrides: Partial<OAuthCredentialProfile> = {}): OAuthCredentialProfile {
  return {
    type: "oauth",
    provider: "openai-codex",
    source: { mode: "gateway-oauth", importedFrom: null, importedAt: null },
    account: { accountId: "acct_123", email: "long.user@example.com" },
    tokens: {
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      expiresAt: "2026-04-27T12:00:00.000Z",
    },
    lastRefresh: { status: "never", at: null, errorCode: null, message: null },
    ...overrides,
  };
}

test("保存并读取单 profile，默认 activeProfileId 可读回 refreshToken", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = sampleProfile();

    await saveCredentialStore(paths, store);
    const loaded = await loadCredentialStore(paths);

    assert.equal(loaded.activeProfileId, DEFAULT_PROFILE_ID);
    assert.equal(loaded.profiles[DEFAULT_PROFILE_ID].tokens.refreshToken, "refresh-token-secret");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("缺失 credentials.json 返回空 store", async () => {
  const home = await tempHome();
  await rm(home, { recursive: true, force: true });
  try {
    const store = await loadCredentialStore(resolveGatewayPaths({ AI_GATEWAY_HOME: home }));

    assert.deepEqual(store, createEmptyCredentialStore());
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("保存后 credentials.json 权限为 0600", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = sampleProfile();

    await saveCredentialStore(paths, store);

    assert.equal((await stat(paths.credentialsPath)).mode & 0o777, 0o600);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("状态摘要不包含 token，并脱敏 email", () => {
  const store = createEmptyCredentialStore();
  store.profiles[DEFAULT_PROFILE_ID] = sampleProfile();

  const summary = summarizeCredentialStore(store);
  const serialized = JSON.stringify(summary);

  assert.equal(summary.loggedIn, true);
  assert.equal(summary.profileId, DEFAULT_PROFILE_ID);
  assert.equal(summary.email, "l***@example.com");
  assert.equal(serialized.includes("access-token-secret"), false);
  assert.equal(serialized.includes("refresh-token-secret"), false);
});

test("状态摘要不会回显 lastRefresh.message 中的潜在 token", () => {
  const store = createEmptyCredentialStore();
  store.profiles[DEFAULT_PROFILE_ID] = sampleProfile({
    lastRefresh: {
      status: "failed",
      at: "2026-04-27T10:00:00.000Z",
      errorCode: "upstream_error",
      message: "refresh failed: access-token-secret refresh-token-secret",
    },
  });

  const summary = summarizeCredentialStore(store);
  const serialized = JSON.stringify(summary);

  assert.equal(serialized.includes("access-token-secret"), false);
  assert.equal(serialized.includes("refresh-token-secret"), false);
  assert.equal(summary.lastRefresh?.message, null);
  assert.equal(summary.lastRefresh?.status, "failed");
  assert.equal(summary.lastRefresh?.errorCode, "upstream_error");
  assert.equal(summary.lastRefresh?.at, "2026-04-27T10:00:00.000Z");
});

test("非字符串 source.mode 抛清晰错误，未知字符串规范化为 gateway-oauth", () => {
  const baseStore = (mode: unknown) => ({
    version: 1,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: {
      [DEFAULT_PROFILE_ID]: {
        ...sampleProfile(),
        source: { mode, importedFrom: null, importedAt: null },
      },
    },
  });

  for (const badMode of [null, 0, 1, true, [], {}]) {
    assert.throws(
      () => parseCredentialStore(baseStore(badMode)),
      /credentials\.json profile openai-codex:default source\.mode 无效/,
      `mode=${JSON.stringify(badMode)} 应抛错`,
    );
  }

  const normalized = parseCredentialStore(baseStore("future-mode"));
  assert.equal(normalized.profiles[DEFAULT_PROFILE_ID].source.mode, "gateway-oauth");

  const omitted = parseCredentialStore({
    version: 1,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: {
      [DEFAULT_PROFILE_ID]: { ...sampleProfile(), source: { importedFrom: null, importedAt: null } },
    },
  });
  assert.equal(omitted.profiles[DEFAULT_PROFILE_ID].source.mode, "gateway-oauth");
});

test("权限不安全的 credentials.json 会被拒绝", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    await writeFile(
      paths.credentialsPath,
      `${JSON.stringify({
        version: 1,
        activeProfileId: DEFAULT_PROFILE_ID,
        profiles: { [DEFAULT_PROFILE_ID]: sampleProfile() },
      })}\n`,
      { mode: 0o644 },
    );
    await chmod(paths.credentialsPath, 0o644);

    await assert.rejects(() => loadCredentialStore(paths), /权限不安全/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("parse 对缺 token 或无效 provider 报清晰错误", () => {
  const validStore = {
    version: 1,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: { [DEFAULT_PROFILE_ID]: sampleProfile() },
  };

  assert.throws(
    () =>
      parseCredentialStore({
        ...validStore,
        profiles: { [DEFAULT_PROFILE_ID]: { ...sampleProfile(), tokens: { accessToken: "a", expiresAt: "e" } } },
      }),
    /credentials\.json profile openai-codex:default tokens\.refreshToken 无效/,
  );
  assert.throws(
    () =>
      parseCredentialStore({
        ...validStore,
        profiles: { [DEFAULT_PROFILE_ID]: { ...sampleProfile(), provider: "unknown" } },
      }),
    /credentials\.json profile openai-codex:default provider 无效/,
  );
});

test("source mode 三种模式保留，未知 mode 规范化为 gateway-oauth", async () => {
  for (const mode of ["gateway-oauth", "codex-cli-imported", "codex-cli-readonly"] satisfies CredentialSourceMode[]) {
    const store = parseCredentialStore({
      version: 1,
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [mode]: sampleProfile({ source: { mode, importedFrom: null, importedAt: null } }),
      },
    });

    assert.equal(store.profiles[mode].source.mode, mode);
  }

  const store = parseCredentialStore({
    version: 1,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: {
      [DEFAULT_PROFILE_ID]: sampleProfile({
        source: { mode: "future-mode" as CredentialSourceMode, importedFrom: "codex", importedAt: "2026-04-27T00:00:00.000Z" },
      }),
    },
  });

  assert.equal(store.profiles[DEFAULT_PROFILE_ID].source.mode, "gateway-oauth");
});

test("saveCredentialStore 校验失败时错误消息指向内存 store 而非磁盘文件", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const broken = {
      version: 1,
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: {
          ...sampleProfile(),
          tokens: { accessToken: "", refreshToken: 42, expiresAt: "2099-01-01T00:00:00.000Z" },
        },
      },
    } as unknown as CredentialStore;

    await assert.rejects(
      () => saveCredentialStore(paths, broken),
      /saveCredentialStore: 内存中的 CredentialStore 不合法/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("saveCredentialStore 写入规范化后的 source mode", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    await saveCredentialStore(paths, {
      version: 1,
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: {
          ...sampleProfile({
            source: { mode: "future-mode" as CredentialSourceMode, importedFrom: null, importedAt: null },
          }),
        },
      },
    });

    const raw = JSON.parse(await readFile(paths.credentialsPath, "utf8"));
    assert.equal(raw.profiles[DEFAULT_PROFILE_ID].source.mode, "gateway-oauth");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
