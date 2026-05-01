import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolveGatewayPaths } from "../src/util/home.js";
import {
  createEmptyCredentialStore,
  loadCredentialStore,
  saveCredentialStore,
} from "../src/auth/credential-store.js";
import {
  AuthUnavailableError,
  CredentialManager,
  isRefreshTokenReusedError,
} from "../src/auth/credential-manager.js";
import { DEFAULT_PROFILE_ID, type OAuthCredentialProfile } from "../src/auth/types.js";

async function tempHome(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "ai-gateway-manager-"));
}

function profile(
  expiresAt: string,
  accessToken = "old-access",
  refreshToken = "old-refresh",
): OAuthCredentialProfile {
  return {
    type: "oauth",
    provider: "openai-codex",
    source: { mode: "gateway-oauth", importedFrom: null, importedAt: null },
    account: { accountId: "acct_1", email: "user@example.com" },
    tokens: { accessToken, refreshToken, expiresAt },
    lastRefresh: { status: "never", at: null, errorCode: null, message: null },
  };
}

test("getAuthContext 返回 accessToken 与 accountId", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2100-01-01T00:00:00.000Z");
    await saveCredentialStore(paths, store);
    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        throw new Error("不应刷新");
      },
      now: () => new Date("2099-01-01T00:00:00.000Z"),
    });

    const ctx = await manager.getAuthContext();
    assert.equal(ctx.accessToken, "old-access");
    assert.equal(ctx.accountId, "acct_1");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("getAuthContext 在 accountId 缺失时返回 null", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    const noAccountId: OAuthCredentialProfile = {
      ...profile("2100-01-01T00:00:00.000Z"),
      account: { accountId: null, email: null },
    };
    store.profiles[DEFAULT_PROFILE_ID] = noAccountId;
    await saveCredentialStore(paths, store);
    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        throw new Error("不应刷新");
      },
      now: () => new Date("2099-01-01T00:00:00.000Z"),
    });

    const ctx = await manager.getAuthContext();
    assert.equal(ctx.accessToken, "old-access");
    assert.equal(ctx.accountId, null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("getAuthContext 在 token 进入刷新窗口时也走刷新路径", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2026-04-25T00:01:00.000Z");
    await saveCredentialStore(paths, store);
    const manager = new CredentialManager({
      paths,
      refreshToken: async () => ({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: "2100-01-01T00:00:00.000Z",
      }),
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    const ctx = await manager.getAuthContext();
    assert.equal(ctx.accessToken, "new-access");
    // 刷新不修改 account 字段，accountId 仍来自原 profile
    assert.equal(ctx.accountId, "acct_1");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("access token 未接近过期时不刷新", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2100-01-01T00:00:00.000Z");
    await saveCredentialStore(paths, store);
    let refreshCalls = 0;
    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        refreshCalls += 1;
        throw new Error("不应刷新");
      },
      now: () => new Date("2099-01-01T00:00:00.000Z"),
    });

    assert.equal(await manager.getAccessToken(), "old-access");
    assert.equal(await manager.getAccessToken(), "old-access");
    assert.equal(refreshCalls, 0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("access token 进入 5 分钟刷新窗口时触发 refresh，并写回磁盘", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2026-04-25T00:01:00.000Z");
    await saveCredentialStore(paths, store);
    let calls = 0;
    const manager = new CredentialManager({
      paths,
      refreshToken: async (refreshToken) => {
        calls += 1;
        assert.equal(refreshToken, "old-refresh");
        return {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresAt: "2100-01-01T00:00:00.000Z",
        };
      },
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    assert.equal(await manager.getAccessToken(), "new-access");
    assert.equal(calls, 1);

    const reloaded = await loadCredentialStore(paths);
    const reloadedProfile = reloaded.profiles[DEFAULT_PROFILE_ID];
    assert.equal(reloadedProfile.tokens.accessToken, "new-access");
    assert.equal(reloadedProfile.tokens.refreshToken, "new-refresh");
    assert.equal(reloadedProfile.tokens.expiresAt, "2100-01-01T00:00:00.000Z");
    assert.equal(reloadedProfile.lastRefresh.status, "success");
    assert.equal(reloadedProfile.lastRefresh.at, "2026-04-25T00:00:00.000Z");
    assert.equal(reloadedProfile.lastRefresh.errorCode, null);
    assert.equal(reloadedProfile.lastRefresh.message, null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("并发请求只触发一次 refresh", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2026-04-25T00:01:00.000Z");
    await saveCredentialStore(paths, store);
    let refreshCalls = 0;
    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { accessToken: "new-access", refreshToken: "new-refresh", expiresAt: "2100-01-01T00:00:00.000Z" };
      },
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    assert.deepEqual(
      await Promise.all([manager.getAccessToken(), manager.getAccessToken(), manager.getAccessToken()]),
      ["new-access", "new-access", "new-access"],
    );
    assert.equal(refreshCalls, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("refresh_token_reused 后采用磁盘上的 winner", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2026-04-25T00:01:00.000Z");
    await saveCredentialStore(paths, store);

    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        // 模拟另一进程在我们 refresh 期间抢先写了新 token 到磁盘
        const disk = await loadCredentialStore(paths);
        disk.profiles[DEFAULT_PROFILE_ID] = profile(
          "2100-01-01T00:00:00.000Z",
          "winner-access",
          "winner-refresh",
        );
        await saveCredentialStore(paths, disk);
        throw new Error("refresh_token_reused");
      },
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    assert.equal(await manager.getAccessToken(), "winner-access");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("refresh_token_reused 但磁盘上仍是过期 token 时仍抛错并落账 lastRefresh", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2026-04-25T00:01:00.000Z");
    await saveCredentialStore(paths, store);

    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        throw new Error("refresh_token_reused");
      },
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    await assert.rejects(() => manager.getAccessToken(), /refresh_token_reused/);

    const reloaded = await loadCredentialStore(paths);
    const reloadedProfile = reloaded.profiles[DEFAULT_PROFILE_ID];
    assert.equal(reloadedProfile.lastRefresh.status, "failed");
    assert.equal(reloadedProfile.lastRefresh.errorCode, "refresh_token_reused");
    assert.equal(reloadedProfile.lastRefresh.message, "refresh_token_reused");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("普通 refresh 失败抛错并把 lastRefresh.status 写为 failed", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2026-04-25T00:01:00.000Z");
    await saveCredentialStore(paths, store);

    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        throw new Error("network error");
      },
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    await assert.rejects(() => manager.getAccessToken(), /network error/);

    const reloaded = await loadCredentialStore(paths);
    const reloadedProfile = reloaded.profiles[DEFAULT_PROFILE_ID];
    assert.equal(reloadedProfile.lastRefresh.status, "failed");
    assert.equal(reloadedProfile.lastRefresh.errorCode, "refresh_failed");
    assert.equal(reloadedProfile.lastRefresh.message, "network error");
    assert.equal(reloadedProfile.tokens.refreshToken, "old-refresh");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("尚未登录时 getAccessToken 抛 AuthUnavailableError", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        throw new Error("不应被调用");
      },
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    await assert.rejects(
      () => manager.getAccessToken(),
      (error: unknown) => error instanceof AuthUnavailableError && /尚未登录/.test(error.message),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("expiresAt 非法格式时进入 refresh 流程而非崩溃", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("not-a-date");
    await saveCredentialStore(paths, store);
    let calls = 0;
    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        calls += 1;
        return {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresAt: "2100-01-01T00:00:00.000Z",
        };
      },
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    assert.equal(await manager.getAccessToken(), "new-access");
    assert.equal(calls, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("isRefreshTokenReusedError 识别 OpenAI 文案", () => {
  assert.equal(isRefreshTokenReusedError(new Error("refresh_token_reused")), true);
  assert.equal(
    isRefreshTokenReusedError(new Error("Your refresh token has already been used to generate a new access token.")),
    true,
  );
  assert.equal(isRefreshTokenReusedError(new Error("network error")), false);
  assert.equal(isRefreshTokenReusedError("refresh_token_reused"), true);
  assert.equal(isRefreshTokenReusedError(null), false);
  assert.equal(isRefreshTokenReusedError(undefined), false);
});

test("isRefreshTokenReusedError 不把 refresh_token_reused 作为子串误判", () => {
  // 词边界保护：不应把含义无关的字段名 + reuse 之类拼接误识别
  assert.equal(
    isRefreshTokenReusedError(new Error('{"error":"invalid_grant","field":"refresh_token","detail":"reused"}')),
    false,
  );
  assert.equal(isRefreshTokenReusedError(new Error("XXrefresh_token_reusedXX")), false);
});

test("refresh RPC 超时被 race 出来并写 failed", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2026-04-25T00:01:00.000Z");
    await saveCredentialStore(paths, store);

    const manager = new CredentialManager({
      paths,
      refreshTimeoutMs: 50,
      refreshToken: async () => {
        // 模拟 refresh 卡住：永远不 resolve / reject。
        await new Promise(() => {});
        throw new Error("unreachable");
      },
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    const start = Date.now();
    await assert.rejects(() => manager.getAccessToken(), /refresh_rpc_timeout/);
    assert.ok(Date.now() - start < 1_000, "refresh 超时未在合理时间触发");

    const reloaded = await loadCredentialStore(paths);
    assert.equal(reloaded.profiles[DEFAULT_PROFILE_ID].lastRefresh.status, "failed");
    assert.equal(reloaded.profiles[DEFAULT_PROFILE_ID].lastRefresh.errorCode, "refresh_failed");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("persistFailedRefresh 自身失败时仍透传原 refresh 错误", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2026-04-25T00:01:00.000Z");
    await saveCredentialStore(paths, store);

    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        // 让 persistFailedRefresh 的 loadCredentialStore 在 JSON parse 时抛错
        await writeFile(paths.credentialsPath, "garbage{not-json", { mode: 0o600 });
        throw new Error("ORIGINAL_REFRESH_ERROR");
      },
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    await assert.rejects(() => manager.getAccessToken(), /ORIGINAL_REFRESH_ERROR/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("persistFailedRefresh 把过长的 error.message 截断后再写盘", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = profile("2026-04-25T00:01:00.000Z");
    await saveCredentialStore(paths, store);

    const longMessage = "x".repeat(5_000);
    const manager = new CredentialManager({
      paths,
      refreshToken: async () => {
        throw new Error(longMessage);
      },
      now: () => new Date("2026-04-25T00:00:00.000Z"),
    });

    await assert.rejects(() => manager.getAccessToken());

    const reloaded = await loadCredentialStore(paths);
    const persistedMessage = reloaded.profiles[DEFAULT_PROFILE_ID].lastRefresh.message;
    assert.ok(persistedMessage, "应写入 message");
    assert.ok(persistedMessage!.length <= 600, `message 未截断: ${persistedMessage!.length}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
