import test from "node:test";
import assert from "node:assert/strict";
import { pollDeviceToken, requestDeviceUserCode } from "../src/auth/codex-device.js";

const BASE = "https://auth.example.test";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("requestDeviceUserCode 用 client_id 发 JSON POST，解析 user_code/device_auth_id/interval", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const fetchFn: typeof fetch = async (url, init) => {
    captured = { url: String(url), init: init ?? {} };
    return jsonResponse(200, {
      device_auth_id: "auth-id-1",
      user_code: "ABCD-1234",
      interval: 7,
    });
  };
  const result = await requestDeviceUserCode({
    fetchFn,
    baseUrl: BASE,
    usercodePath: "/api/accounts/deviceauth/usercode",
    clientId: "client-xyz",
  });
  assert.equal(result.deviceAuthId, "auth-id-1");
  assert.equal(result.userCode, "ABCD-1234");
  assert.equal(result.intervalMs, 7000);
  assert.ok(captured);
  const captured2 = captured as unknown as { url: string; init: RequestInit };
  assert.equal(captured2.url, `${BASE}/api/accounts/deviceauth/usercode`);
  assert.equal(captured2.init.method, "POST");
  const headers = new Headers(captured2.init.headers as HeadersInit);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("accept"), "application/json");
  assert.deepEqual(JSON.parse(String(captured2.init.body)), { client_id: "client-xyz" });
});

test("requestDeviceUserCode 兼容 usercode 别名（CLIProxyAPI 防御）", async () => {
  // CLIProxyAPI sdk/auth/codex_device.go:42 — 上游有时返回 usercode 而不是 user_code
  const fetchFn: typeof fetch = async () =>
    jsonResponse(200, { device_auth_id: "id-2", usercode: "WXYZ-9999" });
  const result = await requestDeviceUserCode({
    fetchFn,
    baseUrl: BASE,
    usercodePath: "/uc",
    clientId: "c",
  });
  assert.equal(result.userCode, "WXYZ-9999");
});

test("requestDeviceUserCode interval 字符串数字也接受", async () => {
  const fetchFn: typeof fetch = async () =>
    jsonResponse(200, { device_auth_id: "id", user_code: "U", interval: "10" });
  const result = await requestDeviceUserCode({
    fetchFn,
    baseUrl: BASE,
    usercodePath: "/uc",
    clientId: "c",
  });
  assert.equal(result.intervalMs, 10000);
});

test("requestDeviceUserCode interval 缺失时使用默认 5s", async () => {
  const fetchFn: typeof fetch = async () =>
    jsonResponse(200, { device_auth_id: "id", user_code: "U" });
  const result = await requestDeviceUserCode({
    fetchFn,
    baseUrl: BASE,
    usercodePath: "/uc",
    clientId: "c",
  });
  assert.equal(result.intervalMs, 5000);
});

test("requestDeviceUserCode 非 2xx 抛错并截断响应体", async () => {
  const long = "x".repeat(500);
  const fetchFn: typeof fetch = async () => new Response(long, { status: 503 });
  await assert.rejects(
    () =>
      requestDeviceUserCode({
        fetchFn,
        baseUrl: BASE,
        usercodePath: "/uc",
        clientId: "c",
      }),
    (err: unknown) =>
      err instanceof Error &&
      /device_usercode_failed.*HTTP 503/.test(err.message) &&
      err.message.length < 350,
  );
});

test("requestDeviceUserCode 缺关键字段（device_auth_id 或 user_code）抛错", async () => {
  const fetchFn: typeof fetch = async () => jsonResponse(200, { device_auth_id: "only-id" });
  await assert.rejects(
    () =>
      requestDeviceUserCode({
        fetchFn,
        baseUrl: BASE,
        usercodePath: "/uc",
        clientId: "c",
      }),
    /device_usercode_missing_fields/,
  );
});

test("pollDeviceToken 200 立刻返回 authorization_code + code_verifier + code_challenge", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const fetchFn: typeof fetch = async (url, init) => {
    captured = { url: String(url), init: init ?? {} };
    return jsonResponse(200, {
      authorization_code: "auth-code-1",
      code_verifier: "verifier-1",
      code_challenge: "challenge-1",
    });
  };
  const result = await pollDeviceToken({
    fetchFn,
    baseUrl: BASE,
    pollPath: "/api/accounts/deviceauth/token",
    deviceAuthId: "auth-id-1",
    userCode: "ABCD-1234",
    intervalMs: 100,
    timeoutMs: 5_000,
    now: () => 0,
    sleep: async () => {},
  });
  assert.equal(result.authorizationCode, "auth-code-1");
  assert.equal(result.codeVerifier, "verifier-1");
  assert.equal(result.codeChallenge, "challenge-1");
  assert.ok(captured);
  const captured2 = captured as unknown as { url: string; init: RequestInit };
  assert.equal(captured2.url, `${BASE}/api/accounts/deviceauth/token`);
  assert.deepEqual(JSON.parse(String(captured2.init.body)), {
    device_auth_id: "auth-id-1",
    user_code: "ABCD-1234",
  });
});

test("pollDeviceToken 403/404 视为 pending，按 interval 继续 poll 直到 200", async () => {
  // CLIProxyAPI sdk/auth/codex_device.go:212-218 — 403 / 404 都是"用户还没授权"
  const sequence = [
    new Response("", { status: 404 }),
    new Response("", { status: 403 }),
    new Response("", { status: 404 }),
    jsonResponse(200, {
      authorization_code: "ac",
      code_verifier: "v",
      code_challenge: "c",
    }),
  ];
  let attempts = 0;
  const sleeps: number[] = [];
  const fetchFn: typeof fetch = async () => {
    attempts += 1;
    return sequence.shift()!;
  };
  const result = await pollDeviceToken({
    fetchFn,
    baseUrl: BASE,
    pollPath: "/p",
    deviceAuthId: "id",
    userCode: "uc",
    intervalMs: 50,
    timeoutMs: 60_000,
    now: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(attempts, 4);
  assert.deepEqual(sleeps, [50, 50, 50]);
  assert.equal(result.authorizationCode, "ac");
});

test("pollDeviceToken 总时间超过 timeoutMs 抛 device_auth_timeout", async () => {
  const fetchFn: typeof fetch = async () => new Response("", { status: 404 });
  let nowValue = 0;
  await assert.rejects(
    () =>
      pollDeviceToken({
        fetchFn,
        baseUrl: BASE,
        pollPath: "/p",
        deviceAuthId: "id",
        userCode: "uc",
        intervalMs: 50,
        timeoutMs: 100,
        now: () => nowValue,
        sleep: async (ms) => {
          nowValue += ms;
        },
      }),
    /device_auth_timeout/,
  );
});

test("pollDeviceToken 500 类错误立即抛错（不视为 pending）", async () => {
  const fetchFn: typeof fetch = async () => new Response("internal boom", { status: 500 });
  await assert.rejects(
    () =>
      pollDeviceToken({
        fetchFn,
        baseUrl: BASE,
        pollPath: "/p",
        deviceAuthId: "id",
        userCode: "uc",
        intervalMs: 50,
        timeoutMs: 5_000,
        now: () => 0,
        sleep: async () => {},
      }),
    (err: unknown) =>
      err instanceof Error &&
      /device_poll_failed.*HTTP 500/.test(err.message),
  );
});

test("pollDeviceToken 200 但缺字段抛 device_token_missing_fields", async () => {
  const fetchFn: typeof fetch = async () =>
    jsonResponse(200, { authorization_code: "ac" });
  await assert.rejects(
    () =>
      pollDeviceToken({
        fetchFn,
        baseUrl: BASE,
        pollPath: "/p",
        deviceAuthId: "id",
        userCode: "uc",
        intervalMs: 50,
        timeoutMs: 5_000,
        now: () => 0,
        sleep: async () => {},
      }),
    /device_token_missing_fields/,
  );
});

test("pollDeviceToken 200 但响应不是 JSON 对象抛 device_token_invalid_response", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () =>
      pollDeviceToken({
        fetchFn,
        baseUrl: BASE,
        pollPath: "/p",
        deviceAuthId: "id",
        userCode: "uc",
        intervalMs: 50,
        timeoutMs: 5_000,
        now: () => 0,
        sleep: async () => {},
      }),
    /device_token_invalid_response/,
  );
});
