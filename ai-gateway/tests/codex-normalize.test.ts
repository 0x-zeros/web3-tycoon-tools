import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCodexRequestBody } from "../src/server/codex-normalize.js";

test("字符串 input 被转成 message 数组", () => {
  const out = normalizeCodexRequestBody({ input: "你好" });
  assert.deepEqual(out.input, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "你好" }],
    },
  ]);
});

test("已经是数组的 input 原样保留", () => {
  const arr = [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hi" }],
    },
  ];
  const out = normalizeCodexRequestBody({ input: arr });
  assert.deepEqual(out.input, arr);
});

test("input 缺失时不强制注入空 message 数组", () => {
  const out = normalizeCodexRequestBody({});
  // 不合成空 input；让上游决定是不是 4xx（CLIProxyAPI 也不主动塞）
  assert.equal(out.input, undefined);
});

test("instructions 缺失时兜底为空串", () => {
  const out = normalizeCodexRequestBody({ input: "hi" });
  assert.equal(out.instructions, "");
});

test("instructions 为 null 时兜底为空串", () => {
  const out = normalizeCodexRequestBody({ input: "hi", instructions: null });
  assert.equal(out.instructions, "");
});

test("instructions 已有非空字符串保留", () => {
  const out = normalizeCodexRequestBody({ input: "hi", instructions: "你是助手" });
  assert.equal(out.instructions, "你是助手");
});

test("强制注入 stream/store/parallel_tool_calls/include", () => {
  const out = normalizeCodexRequestBody({ input: "hi" });
  assert.equal(out.stream, true);
  assert.equal(out.store, false);
  assert.equal(out.parallel_tool_calls, true);
  assert.deepEqual(out.include, ["reasoning.encrypted_content"]);
});

test("客户端发的 stream=false 被强制改成 true", () => {
  const out = normalizeCodexRequestBody({ input: "hi", stream: false });
  assert.equal(out.stream, true);
});

test("客户端发的 store=true 被强制改成 false", () => {
  const out = normalizeCodexRequestBody({ input: "hi", store: true });
  assert.equal(out.store, false);
});

test("删除 Codex 不接受的字段（previous_response_id 等 11 个）", () => {
  const out = normalizeCodexRequestBody({
    input: "hi",
    previous_response_id: "resp_x",
    prompt_cache_retention: "12h",
    safety_identifier: "id_1",
    stream_options: { include_usage: true },
    max_output_tokens: 1000,
    max_completion_tokens: 1000,
    temperature: 0.7,
    top_p: 0.9,
    truncation: "auto",
    context_management: { compaction: { enabled: true } },
    user: "user_xxx",
  });
  assert.equal(out.previous_response_id, undefined);
  assert.equal(out.prompt_cache_retention, undefined);
  assert.equal(out.safety_identifier, undefined);
  assert.equal(out.stream_options, undefined);
  assert.equal(out.max_output_tokens, undefined);
  assert.equal(out.max_completion_tokens, undefined);
  assert.equal(out.temperature, undefined);
  assert.equal(out.top_p, undefined);
  assert.equal(out.truncation, undefined);
  assert.equal(out.context_management, undefined);
  assert.equal(out.user, undefined);
});

test("service_tier 仅当 priority 时保留，其他值删除", () => {
  assert.equal(normalizeCodexRequestBody({ input: "x", service_tier: "priority" }).service_tier, "priority");
  assert.equal(normalizeCodexRequestBody({ input: "x", service_tier: "auto" }).service_tier, undefined);
  assert.equal(normalizeCodexRequestBody({ input: "x", service_tier: "default" }).service_tier, undefined);
});

test("input 数组中 role: system 被改写为 developer", () => {
  const out = normalizeCodexRequestBody({
    input: [
      { type: "message", role: "system", content: [{ type: "input_text", text: "提示词" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "问题" }] },
    ],
  });
  const items = out.input as Array<{ role: string }>;
  assert.equal(items[0].role, "developer");
  assert.equal(items[1].role, "user");
});

test("内置 tool 类型 web_search_preview 被改写为 web_search", () => {
  const out = normalizeCodexRequestBody({
    input: "x",
    tools: [{ type: "web_search_preview" }, { type: "web_search_preview_2025_03_11" }, { type: "web_search" }],
  });
  const tools = out.tools as Array<{ type: string }>;
  assert.equal(tools[0].type, "web_search");
  assert.equal(tools[1].type, "web_search");
  assert.equal(tools[2].type, "web_search");
});

test("tool_choice.type 也走相同的别名归一", () => {
  const out = normalizeCodexRequestBody({
    input: "x",
    tool_choice: { type: "web_search_preview" },
  });
  const tc = out.tool_choice as { type: string };
  assert.equal(tc.type, "web_search");
});
