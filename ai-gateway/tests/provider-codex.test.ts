import test from "node:test";
import assert from "node:assert/strict";
import { CodexProvider, ProviderCooldownError, LocalConcurrencyLimitedError } from "../src/providers/codex.js";

test("CodexProvider 非流式请求转发 Authorization 和模型", async () => {
  const calls: { url: string; body: Record<string, unknown>; auth: string | null; contentType: string | null }[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      auth: headers.get("authorization"),
      contentType: headers.get("content-type"),
    });
    return new Response(JSON.stringify({ id: "resp_1" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  const response = await provider.createResponse({
    accessToken: "token",
    upstreamModel: "real-model",
    body: { model: "alias", input: "hi", stream: false },
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].auth, "Bearer token");
  assert.equal(calls[0].contentType, "application/json");
  assert.equal(calls[0].body.model, "real-model");
  assert.equal(calls[0].body.input, "hi");
  assert.equal(calls[0].url, "https://example.test/codex/responses");
});

test("CodexProvider 在 baseUrl 末尾有斜杠时正确拼接 /responses", async () => {
  const urls: string[] = [];
  const fetchFn: typeof fetch = async (url) => {
    urls.push(String(url));
    return new Response("{}", { status: 200 });
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex/",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  await provider.createResponse({ accessToken: "t", upstreamModel: "m", body: { input: "hi" } });
  assert.equal(urls[0], "https://example.test/codex/responses");
});

test("上游 429 后进入 cooldown，再调用立即抛 ProviderCooldownError", async () => {
  const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 60_000,
  });

  const first = await provider.createResponse({
    accessToken: "token",
    upstreamModel: "real-model",
    body: { model: "alias", input: "hi" },
  });
  assert.equal(first.status, 429);

  await assert.rejects(
    () =>
      provider.createResponse({
        accessToken: "token",
        upstreamModel: "real-model",
        body: { model: "alias", input: "again" },
      }),
    ProviderCooldownError,
  );

  const status = provider.status();
  assert.ok(status.cooldownUntil, "cooldownUntil 应被设置");
  assert.match(status.cooldownUntil!, /^\d{4}-\d{2}-\d{2}T/);
});

test("超过本地并发限制时快速拒绝", async () => {
  const fetchFn: typeof fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return new Response("{}", { status: 200 });
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  const first = provider.createResponse({ accessToken: "t", upstreamModel: "m", body: { input: "one" } });
  await assert.rejects(
    () => provider.createResponse({ accessToken: "t", upstreamModel: "m", body: { input: "two" } }),
    /local_concurrency_limited/,
  );
  await first;

  // 第一个完成后 active 计数应回落，再调用应放行
  const third = await provider.createResponse({
    accessToken: "t",
    upstreamModel: "m",
    body: { input: "three" },
  });
  assert.equal(third.status, 200);
});

test("LocalConcurrencyLimitedError 是独立错误类型", async () => {
  const fetchFn: typeof fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return new Response("{}", { status: 200 });
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  const first = provider.createResponse({ accessToken: "t", upstreamModel: "m", body: { input: "one" } });
  await assert.rejects(
    () => provider.createResponse({ accessToken: "t", upstreamModel: "m", body: { input: "two" } }),
    LocalConcurrencyLimitedError,
  );
  await first;
});

test("provider.refreshToken 用 form-urlencoded 发出并解析响应（含 scope + Accept）", async () => {
  const calls: { url: string; body: string; contentType: string | null; accept: string | null }[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      body: String(init?.body),
      contentType: headers.get("content-type"),
      accept: headers.get("accept"),
    });
    return new Response(
      JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 1800 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  const before = Date.now();
  const result = await provider.refreshToken("old-refresh");
  const after = Date.now();

  assert.equal(result.accessToken, "new-access");
  assert.equal(result.refreshToken, "new-refresh");
  const expiresMs = Date.parse(result.expiresAt);
  assert.ok(expiresMs >= before + 1700_000 && expiresMs <= after + 1900_000);

  assert.equal(calls[0].url, "https://auth.openai.com/oauth/token");
  assert.equal(calls[0].contentType, "application/x-www-form-urlencoded");
  assert.equal(calls[0].accept, "application/json");
  const params = new URLSearchParams(calls[0].body);
  assert.equal(params.get("grant_type"), "refresh_token");
  assert.equal(params.get("refresh_token"), "old-refresh");
  assert.ok(params.get("client_id"));
  // CLIProxyAPI openai_auth.go:195 — refresh 请求必须带 scope；缺这个上游可能返回削减权限的 token
  assert.equal(params.get("scope"), "openid profile email");
});

test("provider.refreshToken 缺 refresh_token 时回退到原 refreshToken", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200 });
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  const result = await provider.refreshToken("old-refresh");
  assert.equal(result.refreshToken, "old-refresh");
});

test("provider.refreshToken 在非 2xx 时抛 oauth_refresh_failed 并截断 body", async () => {
  const longBody = "y".repeat(500);
  const fetchFn: typeof fetch = async () => new Response(longBody, { status: 400 });
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  await assert.rejects(
    () => provider.refreshToken("old-refresh"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /oauth_refresh_failed/);
      assert.match(error.message, /HTTP 400/);
      assert.ok(error.message.length <= 260, `message 未截断: ${error.message.length}`);
      return true;
    },
  );
});

test("provider.refreshToken 在缺 access_token 时抛 oauth_refresh_missing_access_token", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response(JSON.stringify({ refresh_token: "r", expires_in: 3600 }), { status: 200 });
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  await assert.rejects(() => provider.refreshToken("old-refresh"), /oauth_refresh_missing_access_token/);
});

test("CodexProvider 写入 Codex 必备 header 集合（UA/Originator/Connection/Session_id）", async () => {
  let captured!: Headers;
  const fetchFn: typeof fetch = async (_url, init) => {
    captured = new Headers(init?.headers);
    return new Response("{}", { status: 200 });
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  await provider.createResponse({ accessToken: "t", upstreamModel: "m", body: { input: "x" } });
  // User-Agent 必须含 "Mac OS"，否则 Session_id 不会写入
  const ua = captured.get("user-agent") ?? "";
  assert.match(ua, /codex-tui\//);
  assert.match(ua, /Mac OS/);
  assert.equal(captured.get("originator"), "codex-tui");
  assert.equal(captured.get("connection"), "Keep-Alive");
  // Session_id 是 v4 UUID
  const sessionId = captured.get("session_id") ?? "";
  assert.match(sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test("CodexProvider 在传 accountId 时写入 Chatgpt-Account-Id 头", async () => {
  let captured!: Headers;
  const fetchFn: typeof fetch = async (_url, init) => {
    captured = new Headers(init?.headers);
    return new Response("{}", { status: 200 });
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  await provider.createResponse({
    accessToken: "t",
    upstreamModel: "m",
    body: { input: "x" },
    accountId: "acct_real_123",
  });
  assert.equal(captured.get("chatgpt-account-id"), "acct_real_123");
});

test("CodexProvider 在 accountId 为 null 时不写 Chatgpt-Account-Id 头", async () => {
  let captured!: Headers;
  const fetchFn: typeof fetch = async (_url, init) => {
    captured = new Headers(init?.headers);
    return new Response("{}", { status: 200 });
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  await provider.createResponse({
    accessToken: "t",
    upstreamModel: "m",
    body: { input: "x" },
    accountId: null,
  });
  assert.equal(captured.get("chatgpt-account-id"), null);
});

test("CodexProvider 在 stream=true 时 Accept 头是 text/event-stream", async () => {
  let captured!: Headers;
  const fetchFn: typeof fetch = async (_url, init) => {
    captured = new Headers(init?.headers);
    return new Response("{}", { status: 200 });
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  await provider.createResponse({
    accessToken: "t",
    upstreamModel: "m",
    body: { input: "x" },
    stream: true,
  });
  assert.equal(captured.get("accept"), "text/event-stream");
});

test("CodexProvider 在 stream=false（默认）时 Accept 头是 application/json", async () => {
  let captured!: Headers;
  const fetchFn: typeof fetch = async (_url, init) => {
    captured = new Headers(init?.headers);
    return new Response("{}", { status: 200 });
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  await provider.createResponse({
    accessToken: "t",
    upstreamModel: "m",
    body: { input: "x" },
  });
  assert.equal(captured.get("accept"), "application/json");
});

test("CodexProvider 在 fetch 抛错时也回退 activeRequests", async () => {
  const fetchFn: typeof fetch = async () => {
    throw new Error("network down");
  };
  const provider = new CodexProvider({
    baseUrl: "https://example.test/codex",
    fetchFn,
    maxConcurrency: 1,
    cooldownMs: 1000,
  });
  await assert.rejects(
    () => provider.createResponse({ accessToken: "t", upstreamModel: "m", body: { input: "x" } }),
    /network down/,
  );
  // 计数应已回落，下次调用不会被本地并发限流
  assert.equal(provider.status().activeRequests, 0);
});
