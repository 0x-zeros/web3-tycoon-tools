import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  parseCallbackUrl,
  waitForLocalCallback,
} from "../src/auth/oauth.js";
import { createPkcePair } from "../src/auth/pkce.js";

async function pickFreePort(): Promise<number> {
  const srv = http.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

async function waitUntilListening(port: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(100) });
      await res.body?.cancel();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  throw new Error(`port ${port} 未就绪`);
}

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJwt(payload: object): string {
  return `${b64url({ alg: "none" })}.${b64url(payload)}.signature`;
}

test("createPkcePair 生成 S256 challenge", async () => {
  const pair = await createPkcePair();
  assert.match(pair.verifier, /^[A-Za-z0-9_-]{64,}$/);
  assert.match(pair.challenge, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(pair.method, "S256");
  assert.equal(typeof pair.state, "string");
  assert.match(pair.state, /^[A-Za-z0-9_-]{32,}$/);
});

test("createPkcePair 多次调用产生不同的 verifier 与 state", async () => {
  const a = await createPkcePair();
  const b = await createPkcePair();
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.challenge, b.challenge);
  assert.notEqual(a.state, b.state);
});

test("buildAuthorizeUrl 包含 PKCE 和 state", () => {
  const url = buildAuthorizeUrl({
    authBaseUrl: "https://auth.openai.com",
    authorizePath: "/oauth/authorize",
    clientId: "client",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
    scope: "openid profile email offline_access",
    challenge: "challenge",
    state: "state",
  });
  assert.equal(url.origin, "https://auth.openai.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:1455/auth/callback");
  assert.equal(url.searchParams.get("code_challenge"), "challenge");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "state");
  assert.equal(url.searchParams.get("scope"), "openid profile email offline_access");
});

test("buildAuthorizeUrl 在 scope 为全空白时忽略 scope 参数", () => {
  const url = buildAuthorizeUrl({
    authBaseUrl: "https://auth.openai.com",
    authorizePath: "/oauth/authorize",
    clientId: "client",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
    scope: "   ",
    challenge: "c",
    state: "s",
  });
  assert.equal(url.searchParams.get("scope"), null);
});

test("buildAuthorizeUrl 把 extraParams 透传到 query", () => {
  const url = buildAuthorizeUrl({
    authBaseUrl: "https://auth.openai.com",
    authorizePath: "/oauth/authorize",
    clientId: "client",
    redirectUri: "http://localhost:1455/auth/callback",
    scope: "openid",
    challenge: "c",
    state: "s",
    extraParams: {
      prompt: "login",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
    },
  });
  assert.equal(url.searchParams.get("prompt"), "login");
  assert.equal(url.searchParams.get("id_token_add_organizations"), "true");
  assert.equal(url.searchParams.get("codex_cli_simplified_flow"), "true");
});

test("buildAuthorizeUrl 在没有 extraParams 时也能工作", () => {
  const url = buildAuthorizeUrl({
    authBaseUrl: "https://auth.openai.com",
    authorizePath: "/oauth/authorize",
    clientId: "client",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
    scope: "openid",
    challenge: "c",
    state: "s",
  });
  assert.equal(url.searchParams.get("prompt"), null);
});

test("parseCallbackUrl 校验 state 并返回 code", () => {
  const parsed = parseCallbackUrl("http://127.0.0.1:1455/auth/callback?code=abc&state=ok", "ok");
  assert.equal(parsed.code, "abc");
  assert.throws(
    () => parseCallbackUrl("http://127.0.0.1:1455/auth/callback?code=abc&state=bad", "ok"),
    /state mismatch/,
  );
});

test("parseCallbackUrl 拒绝缺失 code 与缺失 state", () => {
  assert.throws(
    () => parseCallbackUrl("http://127.0.0.1:1455/auth/callback?state=ok", "ok"),
    /missing authorization code/,
  );
  assert.throws(
    () => parseCallbackUrl("http://127.0.0.1:1455/auth/callback?code=abc", "ok"),
    /state mismatch/,
  );
});

test("parseCallbackUrl 把上游 error 参数转换成清晰错误", () => {
  assert.throws(
    () =>
      parseCallbackUrl(
        "http://127.0.0.1:1455/auth/callback?error=access_denied&error_description=user+canceled&state=ok",
        "ok",
      ),
    /access_denied/,
  );
});

test("parseCallbackUrl 截断并净化 error_description 防止日志注入", () => {
  const evilDescription = `${"x".repeat(500)}\nFAKE LOG ENTRY: token=secret`;
  assert.throws(
    () =>
      parseCallbackUrl(
        `http://127.0.0.1:1455/auth/callback?error=server_error&error_description=${encodeURIComponent(evilDescription)}&state=ok`,
        "ok",
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^server_error/);
      assert.ok(!error.message.includes("\n"), "error message 包含换行符可能造成日志注入");
      assert.ok(error.message.length <= 250, `error message 未截断: ${error.message.length}`);
      return true;
    },
  );
});

test("parseCallbackUrl 在仅有 error 而无 description 时只用 error code", () => {
  assert.throws(
    () => parseCallbackUrl("http://127.0.0.1:1455/auth/callback?error=server_error&state=ok", "ok"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "server_error");
      return true;
    },
  );
});

test("waitForLocalCallback 在收到合法 callback 时 resolve", async () => {
  const port = await pickFreePort();
  const promise = waitForLocalCallback({
    port,
    path: "/auth/callback",
    expectedState: "ok",
    timeoutMs: 5_000,
  });
  await waitUntilListening(port);

  const res = await fetch(`http://127.0.0.1:${port}/auth/callback?code=abc&state=ok`);
  assert.equal(res.status, 200);
  // HTTP/1.1 默认 keep-alive — 不主动关 socket，server.close() 会等到 idle 超时才返回，
  // 让 CLI 进程在 "OAuth 登录完成" 之后挂住。所有响应必须显式 Connection: close。
  assert.equal(res.headers.get("connection"), "close");
  assert.match(await res.text(), /登录完成/);

  const result = await promise;
  assert.equal(result.code, "abc");
});

test("waitForLocalCallback 超时", async () => {
  const port = await pickFreePort();
  const start = Date.now();
  await assert.rejects(
    () =>
      waitForLocalCallback({
        port,
        path: "/auth/callback",
        expectedState: "ok",
        timeoutMs: 100,
      }),
    /oauth_callback_timeout/,
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1_000, `超时未在合理时间触发: ${elapsed}ms`);
});

test("waitForLocalCallback IPv6 ::1 上的 callback 也能 resolve（双栈绑定）", async () => {
  const port = await pickFreePort();
  const promise = waitForLocalCallback({
    port,
    path: "/auth/callback",
    expectedState: "ok",
    timeoutMs: 5_000,
  });
  await waitUntilListening(port);

  // 故意通过 ::1（IPv6 loopback）发请求；浏览器把 localhost 解析到 ::1 时就走这条
  const res = await fetch(`http://[::1]:${port}/auth/callback?code=v6-code&state=ok`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /登录完成/);

  const result = await promise;
  assert.equal(result.code, "v6-code");
});

test("waitForLocalCallback 端口被占用时立即 reject 并清理 timer", async () => {
  const port = await pickFreePort();
  const occupier = http.createServer();
  await new Promise<void>((r) => occupier.listen(port, "127.0.0.1", () => r()));
  try {
    const start = Date.now();
    await assert.rejects(
      () =>
        waitForLocalCallback({
          port,
          path: "/auth/callback",
          expectedState: "ok",
          timeoutMs: 500,
        }),
      (error: unknown) => error instanceof Error && /EADDRINUSE/.test(error.message),
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1_000, `listen-error 路径未立即 reject: ${elapsed}ms`);
  } finally {
    await new Promise<void>((r) => occupier.close(() => r()));
  }
});

test("waitForLocalCallback 忽略非 callback 路径并继续等待真正的 callback", async () => {
  const port = await pickFreePort();
  const promise = waitForLocalCallback({
    port,
    path: "/auth/callback",
    expectedState: "ok",
    timeoutMs: 5_000,
  });
  await waitUntilListening(port);

  const fav = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
  assert.equal(fav.status, 404);
  await fav.body?.cancel();

  const cb = await fetch(`http://127.0.0.1:${port}/auth/callback?code=zzz&state=ok`);
  assert.equal(cb.status, 200);
  await cb.text();

  const result = await promise;
  assert.equal(result.code, "zzz");
});

test("exchangeAuthorizationCode 优先用 id_token 提 accountId/email", async () => {
  // CLIProxyAPI 同款行为：access_token 和 id_token 都是 JWT，但 chatgpt_account_id
  // 在 id_token 里更稳定。我们应该优先解 id_token。
  const idJwt = fakeJwt({
    exp: 4102444800,
    email: "id-token@example.com",
    "https://api.openai.com/auth": { chatgpt_account_id: "acct_from_id_token" },
  });
  const accessJwt = fakeJwt({
    exp: 4102444800,
    // access_token 故意不带 email / 嵌套 auth 对象，看是否回退用 id_token
  });
  const fetchFn: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: accessJwt,
        id_token: idJwt,
        refresh_token: "refresh",
        expires_in: 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const result = await exchangeAuthorizationCode({
    fetchFn,
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: "client",
    code: "code",
    codeVerifier: "verifier",
    redirectUri: "http://localhost:1455/auth/callback",
  });
  assert.equal(result.accountId, "acct_from_id_token");
  assert.equal(result.email, "id-token@example.com");
});

test("exchangeAuthorizationCode 在没有 id_token 时回退到 access_token", async () => {
  const accessJwt = fakeJwt({
    exp: 4102444800,
    email: "fallback@example.com",
    "https://api.openai.com/auth": { chatgpt_account_id: "acct_fallback" },
  });
  const fetchFn: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: accessJwt,
        refresh_token: "refresh",
        expires_in: 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const result = await exchangeAuthorizationCode({
    fetchFn,
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: "client",
    code: "code",
    codeVerifier: "verifier",
    redirectUri: "http://localhost:1455/auth/callback",
  });
  assert.equal(result.accountId, "acct_fallback");
  assert.equal(result.email, "fallback@example.com");
});

test("exchangeAuthorizationCode 解析 token 响应并填充 expiresAt", async () => {
  const accessJwt = fakeJwt({
    exp: 4102444800,
    email: "user@example.com",
    "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" },
  });
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    calls.push({
      url: String(url),
      body: String(init?.body),
      headers: Object.fromEntries(new Headers(init?.headers ?? {})),
    });
    return new Response(
      JSON.stringify({
        access_token: accessJwt,
        refresh_token: "refresh",
        expires_in: 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await exchangeAuthorizationCode({
    fetchFn,
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: "client",
    code: "code",
    codeVerifier: "verifier",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
  });

  assert.equal(result.accessToken, accessJwt);
  assert.equal(result.refreshToken, "refresh");
  assert.equal(result.email, "user@example.com");
  assert.equal(result.accountId, "acct_1");

  // 验证发请求时带了正确的 Accept 头
  assert.equal(calls[0].headers["accept"], "application/json");

  const before = Date.now();
  const expiresMs = Date.parse(result.expiresAt);
  // expires_in 优先：~3600 秒后
  assert.ok(expiresMs >= before + 3500_000 && expiresMs <= before + 3700_000, `expiresAt: ${result.expiresAt}`);

  // 请求形态：POST + form-urlencoded + 完整字段
  assert.equal(calls[0].url, "https://auth.openai.com/oauth/token");
  const params = new URLSearchParams(calls[0].body);
  assert.equal(params.get("grant_type"), "authorization_code");
  assert.equal(params.get("code"), "code");
  assert.equal(params.get("redirect_uri"), "http://127.0.0.1:1455/auth/callback");
  assert.equal(params.get("client_id"), "client");
  assert.equal(params.get("code_verifier"), "verifier");
  assert.equal(calls[0].headers["content-type"], "application/x-www-form-urlencoded");
});

test("exchangeAuthorizationCode 在缺 expires_in 时回退到 JWT exp", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: fakeJwt({ exp: 4102444800 }),
        refresh_token: "r",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const result = await exchangeAuthorizationCode({
    fetchFn,
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: "c",
    code: "x",
    codeVerifier: "v",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
  });
  assert.equal(result.expiresAt, "2100-01-01T00:00:00.000Z");
});

test("exchangeAuthorizationCode 在 expires_in 与 JWT exp 都缺失时走 1 小时 fallback", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: "opaque-not-a-jwt",
        refresh_token: "r",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const before = Date.now();
  const result = await exchangeAuthorizationCode({
    fetchFn,
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: "c",
    code: "x",
    codeVerifier: "v",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
  });
  const after = Date.now();
  const expiresMs = Date.parse(result.expiresAt);
  assert.ok(expiresMs >= before + 59 * 60_000, `expiresAt 早于 59 分钟: ${result.expiresAt}`);
  assert.ok(expiresMs <= after + 61 * 60_000, `expiresAt 晚于 61 分钟: ${result.expiresAt}`);
  assert.equal(result.email, null);
  assert.equal(result.accountId, null);
});

test("exchangeAuthorizationCode 在 expires_in 非正数 / 非数字时忽略并走 fallback", async () => {
  for (const expires_in of [-1, 0, "soon", null]) {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: fakeJwt({ exp: 4102444800 }),
          refresh_token: "r",
          expires_in,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const result = await exchangeAuthorizationCode({
      fetchFn,
      tokenUrl: "https://auth.openai.com/oauth/token",
      clientId: "c",
      code: "x",
      codeVerifier: "v",
      redirectUri: "http://127.0.0.1:1455/auth/callback",
    });
    assert.equal(result.expiresAt, "2100-01-01T00:00:00.000Z", `expires_in=${JSON.stringify(expires_in)}`);
  }
});

test("exchangeAuthorizationCode 在 HTTP 非 2xx 时抛错并把响应体截断到 200 字节", async () => {
  const longBody = "x".repeat(500);
  const fetchFn: typeof fetch = async () =>
    new Response(longBody, { status: 400, headers: { "content-type": "text/plain" } });
  await assert.rejects(
    () =>
      exchangeAuthorizationCode({
        fetchFn,
        tokenUrl: "https://auth.openai.com/oauth/token",
        clientId: "c",
        code: "x",
        codeVerifier: "v",
        redirectUri: "http://127.0.0.1:1455/auth/callback",
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /oauth_token_exchange_failed/);
      assert.match(error.message, /HTTP 400/);
      // 前缀 "oauth_token_exchange_failed: HTTP 400 " ≈ 38 字节 + 截断到 200 字节 → 上限约 240
      assert.ok(error.message.length <= 250, `错误消息未截断到 200 字节: ${error.message.length}`);
      // 原始 body 500 个 x，截断后 200 个，不应包含 201 个连续 x
      assert.ok(!error.message.includes("x".repeat(201)));
      return true;
    },
  );
});

test("exchangeAuthorizationCode 在缺 access_token 或 refresh_token 时抛错", async () => {
  const fetchOnlyAccess: typeof fetch = async () =>
    new Response(JSON.stringify({ access_token: "a" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  await assert.rejects(
    () =>
      exchangeAuthorizationCode({
        fetchFn: fetchOnlyAccess,
        tokenUrl: "u",
        clientId: "c",
        code: "x",
        codeVerifier: "v",
        redirectUri: "r",
      }),
    /oauth_token_exchange_missing_tokens/,
  );

  const fetchOnlyRefresh: typeof fetch = async () =>
    new Response(JSON.stringify({ refresh_token: "r" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  await assert.rejects(
    () =>
      exchangeAuthorizationCode({
        fetchFn: fetchOnlyRefresh,
        tokenUrl: "u",
        clientId: "c",
        code: "x",
        codeVerifier: "v",
        redirectUri: "r",
      }),
    /oauth_token_exchange_missing_tokens/,
  );
});

test("exchangeAuthorizationCode 在响应非 JSON 时抛错且不泄露 token 字段", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response("<html>not json</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  await assert.rejects(
    () =>
      exchangeAuthorizationCode({
        fetchFn,
        tokenUrl: "u",
        clientId: "c",
        code: "x",
        codeVerifier: "v",
        redirectUri: "r",
      }),
    /oauth_token_exchange_invalid_response/,
  );
});
