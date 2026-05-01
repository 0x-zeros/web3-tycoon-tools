import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import {
  readCodexCliAuthJson,
  resolveCodexCliAuthPath,
  toImportedCodexProfile,
} from "../src/auth/codex-cli.js";
import {
  decodeJwtPayload,
  resolveJwtAccountId,
  resolveJwtEmail,
  resolveJwtExpiryIso,
} from "../src/auth/jwt.js";

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJwt(payload: object): string {
  return `${b64url({ alg: "none" })}.${b64url(payload)}.signature`;
}

async function tempDir(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "ai-gateway-codex-cli-"));
}

test("decodeJwtPayload 解码 payload", () => {
  assert.deepEqual(decodeJwtPayload(fakeJwt({ exp: 4102444800, email: "user@example.com" })), {
    exp: 4102444800,
    email: "user@example.com",
  });
});

test("decodeJwtPayload 对非 JWT 字符串返回 null", () => {
  assert.equal(decodeJwtPayload("not-a-jwt"), null);
  assert.equal(decodeJwtPayload(""), null);
  assert.equal(decodeJwtPayload("only.notbase64.sig"), null);
});

test("resolveJwtExpiryIso 从 exp 得到 ISO 时间", () => {
  assert.equal(resolveJwtExpiryIso(fakeJwt({ exp: 4102444800 })), "2100-01-01T00:00:00.000Z");
});

test("resolveJwtExpiryIso 对缺失 / 非数字 / 非有限 exp 返回 null", () => {
  assert.equal(resolveJwtExpiryIso(fakeJwt({})), null);
  assert.equal(resolveJwtExpiryIso(fakeJwt({ exp: "soon" })), null);
  assert.equal(resolveJwtExpiryIso(fakeJwt({ exp: Number.NaN })), null);
  assert.equal(resolveJwtExpiryIso(fakeJwt({ exp: 0 })), null);
  assert.equal(resolveJwtExpiryIso(fakeJwt({ exp: -1 })), null);
});

test("resolveJwtEmail 从顶层 email claim 读取，对无效值返回 null", () => {
  // CLIProxyAPI internal/auth/codex/jwt_parser.go:19 显示 email 就在顶层 email 字段
  assert.equal(resolveJwtEmail(fakeJwt({ email: "raw@example.com" })), "raw@example.com");
  assert.equal(resolveJwtEmail(fakeJwt({ email: "no-at-sign" })), null);
  assert.equal(resolveJwtEmail(fakeJwt({})), null);
  assert.equal(resolveJwtEmail("garbage"), null);
});

test("resolveJwtAccountId 从 https://api.openai.com/auth.chatgpt_account_id 嵌套对象中读取", () => {
  // Codex JWT 真实结构（参考 CLIProxyAPI internal/auth/codex/jwt_parser.go:14-52）：
  // 顶层 claim "https://api.openai.com/auth" 是一个对象，内部有 chatgpt_account_id 字段
  const token = fakeJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_real_codex",
      chatgpt_user_id: "user_xyz",
    },
    sub: "different_sub",
  });
  assert.equal(resolveJwtAccountId(token), "acct_real_codex");
});

test("resolveJwtAccountId 对嵌套对象里带空白的值 trim 后返回", () => {
  assert.equal(
    resolveJwtAccountId(
      fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "  acct_spaced  " } }),
    ),
    "acct_spaced",
  );
});

test("resolveJwtAccountId 在嵌套对象缺失或字段空时返回 null", () => {
  // 完全没有 https://api.openai.com/auth claim
  assert.equal(resolveJwtAccountId(fakeJwt({})), null);
  // 有 claim 但不是对象
  assert.equal(resolveJwtAccountId(fakeJwt({ "https://api.openai.com/auth": "not-an-object" })), null);
  // 有对象但 chatgpt_account_id 缺失
  assert.equal(resolveJwtAccountId(fakeJwt({ "https://api.openai.com/auth": {} })), null);
  // 有 chatgpt_account_id 但全是空白
  assert.equal(
    resolveJwtAccountId(fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "   " } })),
    null,
  );
  // 不退回到 sub / account_id 等字段，避免泄漏不准确的标识
  assert.equal(resolveJwtAccountId(fakeJwt({ sub: "user_sub" })), null);
  assert.equal(resolveJwtAccountId(fakeJwt({ account_id: "acct_top" })), null);
});

test("resolveCodexCliAuthPath 默认走 ~/.codex/auth.json，CODEX_HOME 覆盖目录", () => {
  assert.equal(resolveCodexCliAuthPath({}), path.join(os.homedir(), ".codex", "auth.json"));
  assert.equal(
    resolveCodexCliAuthPath({ CODEX_HOME: "/tmp/custom-codex" }),
    path.join("/tmp/custom-codex", "auth.json"),
  );
  assert.equal(
    resolveCodexCliAuthPath({ CODEX_HOME: "   " }),
    path.join(os.homedir(), ".codex", "auth.json"),
  );
  assert.equal(
    resolveCodexCliAuthPath({ CODEX_HOME: "  /tmp/custom-codex  " }),
    path.join("/tmp/custom-codex", "auth.json"),
  );
});

test("读取 CODEX_HOME/auth.json 的 tokens 结构", async () => {
  const dir = await tempDir();
  try {
    const authPath = path.join(dir, "auth.json");
    await writeFile(
      authPath,
      JSON.stringify({
        tokens: {
          access_token: fakeJwt({ exp: 4102444800, email: "user@example.com" }),
          refresh_token: "refresh-token",
          account_id: "acct_1",
        },
      }),
      "utf8",
    );
    const credential = await readCodexCliAuthJson({ CODEX_HOME: dir });
    assert.equal(credential?.refreshToken, "refresh-token");
    assert.equal(credential?.accountId, "acct_1");
    assert.equal(credential?.email, "user@example.com");
    assert.equal(credential?.expiresAt, "2100-01-01T00:00:00.000Z");
    assert.equal(credential?.sourcePath, authPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auth.json 缺失时返回 null", async () => {
  const dir = await tempDir();
  await rm(dir, { recursive: true, force: true });
  assert.equal(await readCodexCliAuthJson({ CODEX_HOME: dir }), null);
});

test("缺少 refresh_token 时返回 null", async () => {
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "auth.json"), JSON.stringify({ tokens: { access_token: "access" } }), "utf8");
    assert.equal(await readCodexCliAuthJson({ CODEX_HOME: dir }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("缺少 access_token 时返回 null", async () => {
  const dir = await tempDir();
  try {
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({ tokens: { refresh_token: "refresh" } }),
      "utf8",
    );
    assert.equal(await readCodexCliAuthJson({ CODEX_HOME: dir }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auth.json 不可解析时抛带源路径的错误", async () => {
  const dir = await tempDir();
  try {
    const authPath = path.join(dir, "auth.json");
    await writeFile(authPath, "not-json", "utf8");
    await assert.rejects(
      () => readCodexCliAuthJson({ CODEX_HOME: dir }),
      (error) => error instanceof Error && error.message.includes(authPath),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("access_token 不是合法 JWT 时 expiresAt 走 fallback（约 1 小时后）", async () => {
  const dir = await tempDir();
  try {
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({ tokens: { access_token: "opaque-token", refresh_token: "refresh-token" } }),
      "utf8",
    );
    const before = Date.now();
    const credential = await readCodexCliAuthJson({ CODEX_HOME: dir });
    const after = Date.now();

    assert.ok(credential);
    const expiresMs = Date.parse(credential!.expiresAt);
    assert.ok(expiresMs >= before + 59 * 60_000, `expiresAt 早于 59 分钟: ${credential!.expiresAt}`);
    assert.ok(expiresMs <= after + 61 * 60_000, `expiresAt 晚于 61 分钟: ${credential!.expiresAt}`);
    assert.equal(credential!.email, null);
    assert.equal(credential!.accountId, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auth.json 内的 account_id 优先于 JWT 解出的 account id", async () => {
  const dir = await tempDir();
  try {
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({
        tokens: {
          access_token: fakeJwt({
            exp: 4102444800,
            "https://api.openai.com/auth.chatgpt_account_user_id": "acct_jwt",
          }),
          refresh_token: "refresh-token",
          account_id: "acct_file",
        },
      }),
      "utf8",
    );
    const credential = await readCodexCliAuthJson({ CODEX_HOME: dir });
    assert.equal(credential?.accountId, "acct_file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file 内 account_id 为空字符串时回退到 JWT", async () => {
  const dir = await tempDir();
  try {
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({
        tokens: {
          access_token: fakeJwt({
            exp: 4102444800,
            "https://api.openai.com/auth": { chatgpt_account_id: "acct_jwt" },
          }),
          refresh_token: "refresh-token",
          account_id: "",
        },
      }),
      "utf8",
    );
    const credential = await readCodexCliAuthJson({ CODEX_HOME: dir });
    assert.equal(credential?.accountId, "acct_jwt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("access_token / refresh_token 为全空白字符串时返回 null", async () => {
  const dir = await tempDir();
  try {
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({ tokens: { access_token: "   ", refresh_token: "refresh" } }),
      "utf8",
    );
    assert.equal(await readCodexCliAuthJson({ CODEX_HOME: dir }), null);

    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({ tokens: { access_token: "access", refresh_token: "\t\n" } }),
      "utf8",
    );
    assert.equal(await readCodexCliAuthJson({ CODEX_HOME: dir }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("缺少 file 内 account_id 时回退到 JWT", async () => {
  const dir = await tempDir();
  try {
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({
        tokens: {
          access_token: fakeJwt({
            exp: 4102444800,
            "https://api.openai.com/auth": { chatgpt_account_id: "acct_jwt" },
          }),
          refresh_token: "refresh-token",
        },
      }),
      "utf8",
    );
    const credential = await readCodexCliAuthJson({ CODEX_HOME: dir });
    assert.equal(credential?.accountId, "acct_jwt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("导入 Codex CLI 凭据时标记 source mode 和来源路径", () => {
  const profile = toImportedCodexProfile({
    accessToken: fakeJwt({ exp: 4102444800, email: "user@example.com" }),
    refreshToken: "refresh-token",
    expiresAt: "2100-01-01T00:00:00.000Z",
    accountId: "acct_1",
    email: "user@example.com",
    sourcePath: "/tmp/codex/auth.json",
  });
  assert.equal(profile.source.mode, "codex-cli-imported");
  assert.equal(profile.source.importedFrom, "/tmp/codex/auth.json");
  assert.equal(profile.tokens.refreshToken, "refresh-token");
  assert.equal(profile.account.accountId, "acct_1");
  assert.equal(profile.account.email, "user@example.com");
  assert.equal(profile.lastRefresh.status, "never");
  assert.ok(profile.source.importedAt && !Number.isNaN(Date.parse(profile.source.importedAt)));
});
