import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createGatewayServer } from "../src/server/http.js";
import type { GatewayConfig } from "../src/config/types.js";
import type { CredentialStatusSummary } from "../src/auth/types.js";

const config: GatewayConfig = {
  version: 1,
  defaultModelAlias: "codex-default",
  models: { "codex-default": { provider: "openai-codex", upstreamModel: "real-model" } },
  server: { host: "127.0.0.1", port: 0, maxConcurrency: 4, cooldownMs: 30_000 },
};

const summary: CredentialStatusSummary = {
  loggedIn: true,
  profileId: "openai-codex:default",
  provider: "openai-codex",
  sourceMode: "gateway-oauth",
  accountId: "acct",
  email: "u***@example.com",
  expiresAt: "2100-01-01T00:00:00.000Z",
  lastRefresh: null,
};

const baseProvider = {
  status: () => ({ activeRequests: 0, cooldownUntil: null, maxConcurrency: 4 }),
};

/** 构造一个最小可被网关聚合的上游 SSE 响应。 */
function sseCompletion(response: Record<string, unknown>): Response {
  const body = `data: ${JSON.stringify({ type: "response.completed", response })}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server address unavailable");
  }
  return `http://127.0.0.1:${address.port}`;
}

test("GET /health 返回 ok", async () => {
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: { ...baseProvider, createResponse: async () => sseCompletion({}) },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    server.close();
  }
});

test("GET / 返回 HTML 状态页", async () => {
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: { ...baseProvider, createResponse: async () => sseCompletion({}) },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /AI Gateway/);
    assert.match(html, /\/status/);
  } finally {
    server.close();
  }
});

test("GET /status 返回模型清单 + auth + provider", async () => {
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: { ...baseProvider, createResponse: async () => sseCompletion({}) },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/status`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      auth: CredentialStatusSummary;
      models: string[];
      defaultModelAlias: string;
      provider: { activeRequests: number; cooldownUntil: string | null; maxConcurrency: number };
    };
    assert.equal(body.defaultModelAlias, "codex-default");
    assert.deepEqual(body.models, ["codex-default"]);
    assert.equal(body.auth.loggedIn, true);
    assert.equal(body.provider.maxConcurrency, 4);
  } finally {
    server.close();
  }
});

test("POST /v1/responses 映射模型别名并转发", async () => {
  let capturedBody: unknown = null;
  let capturedModel: string | null = null;
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async (params) => {
        capturedBody = params.body;
        capturedModel = params.upstreamModel;
        return sseCompletion({ id: "resp_1" });
      },
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "codex-default", input: "hi" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: "resp_1" });
    // 网关在转发前做完整 Codex 规范化：input 字符串→message 数组，
    // instructions 兜底空串，强制 stream/store/parallel_tool_calls/include
    assert.deepEqual(capturedBody, {
      model: "codex-default",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        },
      ],
      instructions: "",
      stream: true,
      store: false,
      parallel_tool_calls: true,
      include: ["reasoning.encrypted_content"],
    });
    assert.equal(capturedModel, "real-model");
  } finally {
    server.close();
  }
});

test("POST /v1/responses 未指定 model 时使用默认别名", async () => {
  let capturedModel: string | null = null;
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async (params) => {
        capturedModel = params.upstreamModel;
        return sseCompletion({ id: "resp_x" });
      },
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    assert.equal(response.status, 200);
    assert.equal(capturedModel, "real-model");
  } finally {
    server.close();
  }
});

test("POST /v1/responses 未在 ALLOWED 列表的字段透传给上游（不再 4xx）", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async (params) => {
        capturedBody = params.body as Record<string, unknown>;
        return sseCompletion({ id: "resp_x" });
      },
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    // tools / reasoning 这类是真实 OpenAI Responses API 字段，必须放行给上游
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "hi",
        tools: [{ type: "web_search" }],
        reasoning: { effort: "medium" },
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(capturedBody!.tools, [{ type: "web_search" }]);
    assert.deepEqual(capturedBody!.reasoning, { effort: "medium" });
  } finally {
    server.close();
  }
});

test("POST /v1/responses 删除 4 个 Codex 上游不接受的字段（previous_response_id 等）", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async (params) => {
        capturedBody = params.body as Record<string, unknown>;
        return sseCompletion({});
      },
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "hi",
        previous_response_id: "resp_x",
        prompt_cache_retention: "12h",
        safety_identifier: "id_1",
        stream_options: { include_usage: true },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(capturedBody!.previous_response_id, undefined);
    assert.equal(capturedBody!.prompt_cache_retention, undefined);
    assert.equal(capturedBody!.safety_identifier, undefined);
    assert.equal(capturedBody!.stream_options, undefined);
  } finally {
    server.close();
  }
});

test("POST /v1/responses 在 instructions 缺失时塞空串", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async (params) => {
        capturedBody = params.body as Record<string, unknown>;
        return sseCompletion({});
      },
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    assert.equal(capturedBody!.instructions, "");
  } finally {
    server.close();
  }
});

test("POST /v1/responses 在 instructions 为 null 时塞空串", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async (params) => {
        capturedBody = params.body as Record<string, unknown>;
        return sseCompletion({});
      },
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi", instructions: null }),
    });
    assert.equal(capturedBody!.instructions, "");
  } finally {
    server.close();
  }
});

test("POST /v1/responses 在 instructions 已有内容时保留", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async (params) => {
        capturedBody = params.body as Record<string, unknown>;
        return sseCompletion({});
      },
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi", instructions: "你是助手" }),
    });
    assert.equal(capturedBody!.instructions, "你是助手");
  } finally {
    server.close();
  }
});

test("POST /v1/responses 客户端 stream=false 时上游 body.stream 仍强制为 true", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  let capturedStream: boolean | undefined;
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async (params) => {
        capturedBody = params.body as Record<string, unknown>;
        capturedStream = params.stream;
        // 模拟上游 SSE：output_item.done + response.completed
        const sse =
          'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","content":[{"type":"output_text","text":"嗨"}]}}\n\n' +
          'data: {"type":"response.completed","response":{"id":"resp_x","output":[]}}\n\n';
        return new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi", stream: false }),
    });
    // 客户端要的是 JSON
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type")?.startsWith("application/json"), true);
    const json = (await response.json()) as { id?: string; output?: unknown[] };
    assert.equal(json.id, "resp_x");
    // output[] 应该被 output_item.done 事件回填
    assert.deepEqual(json.output, [
      { type: "message", content: [{ type: "output_text", text: "嗨" }] },
    ]);
    // 上游一定要 stream=true（不管客户端要啥）
    assert.equal(capturedBody!.stream, true);
    assert.equal(capturedStream, true);
  } finally {
    server.close();
  }
});

test("POST /v1/responses 客户端 stream=true 时 SSE 直通", async () => {
  const sse =
    'data: {"type":"response.created"}\n\n' +
    'data: {"type":"response.output_text.delta","delta":"hi"}\n\n' +
    'data: {"type":"response.completed","response":{"id":"resp_y"}}\n\n';
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async () =>
        new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi", stream: true }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /response\.created/);
    assert.match(text, /response\.completed/);
    assert.match(text, /resp_y/);
  } finally {
    server.close();
  }
});

test("POST /v1/responses 把 accountId 透传给 provider.createResponse", async () => {
  let capturedAccountId: string | null | undefined;
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: {
      getAuthContext: async () => ({ accessToken: "access", accountId: "acct_xyz_789" }),
    },
    provider: {
      ...baseProvider,
      createResponse: async (params) => {
        capturedAccountId = params.accountId;
        return sseCompletion({});
      },
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    assert.equal(capturedAccountId, "acct_xyz_789");
  } finally {
    server.close();
  }
});

test("POST /v1/responses 非法 JSON 返回 invalid_json", async () => {
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: { ...baseProvider, createResponse: async () => sseCompletion({}) },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "invalid_json");
  } finally {
    server.close();
  }
});

test("POST /v1/responses 未知模型别名返回 unknown_model_alias", async () => {
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: { ...baseProvider, createResponse: async () => sseCompletion({}) },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "unknown-alias", input: "hi" }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "unknown_model_alias");
  } finally {
    server.close();
  }
});

test("POST /v1/responses CredentialManager 抛 AuthUnavailableError 时返回 503", async () => {
  const { AuthUnavailableError } = await import("../src/auth/credential-manager.js");
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: {
      getAuthContext: async () => {
        throw new AuthUnavailableError("尚未登录，请先执行 auth login");
      },
    },
    provider: { ...baseProvider, createResponse: async () => sseCompletion({}) },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "auth_unavailable");
  } finally {
    server.close();
  }
});

test("POST /v1/responses 上游进入 cooldown 时返回 429", async () => {
  const { ProviderCooldownError } = await import("../src/providers/codex.js");
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async () => {
        throw new ProviderCooldownError();
      },
    },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    assert.equal(response.status, 429);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "upstream_cooldown");
  } finally {
    server.close();
  }
});

test("POST /v1/responses 调用 RequestLogger 一次", async () => {
  const events: unknown[] = [];
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: {
      ...baseProvider,
      createResponse: async () => sseCompletion({ id: "ok" }),
    },
    credentialStatus: async () => summary,
    requestLogger: {
      logRequest: async (event) => {
        events.push(event);
      },
    },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "codex-default", input: "hi" }),
    });
    assert.equal(response.status, 200);
    assert.equal(events.length, 1);
    const event = events[0] as { modelAlias: string; upstreamModel: string; statusCode: number };
    assert.equal(event.modelAlias, "codex-default");
    assert.equal(event.upstreamModel, "real-model");
    assert.equal(event.statusCode, 200);
  } finally {
    server.close();
  }
});

test("配置 API token 后要求 Bearer", async () => {
  const server = createGatewayServer({
    config,
    apiToken: "secret",
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: { ...baseProvider, createResponse: async () => sseCompletion({}) },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const unauth = await fetch(`${baseUrl}/status`);
    assert.equal(unauth.status, 401);
    const body = (await unauth.json()) as { error: { code: string } };
    assert.equal(body.error.code, "unauthorized");

    const ok = await fetch(`${baseUrl}/status`, { headers: { authorization: "Bearer secret" } });
    assert.equal(ok.status, 200);

    const badToken = await fetch(`${baseUrl}/status`, { headers: { authorization: "Bearer wrong" } });
    assert.equal(badToken.status, 401);
  } finally {
    server.close();
  }
});

test("未知路径返回 404 not_found", async () => {
  const server = createGatewayServer({
    config,
    apiToken: undefined,
    credentialManager: { getAuthContext: async () => ({ accessToken: "access", accountId: "acct" }) },
    provider: { ...baseProvider, createResponse: async () => sseCompletion({}) },
    credentialStatus: async () => summary,
    requestLogger: { logRequest: async () => undefined },
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/nope`);
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "not_found");
  } finally {
    server.close();
  }
});
