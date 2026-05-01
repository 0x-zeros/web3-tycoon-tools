// check:responses
// 调 POST /v1/responses（stream: false），故意不发 instructions——模拟
// "什么都不知道的 OpenAI 兼容客户端"。网关侧 normalize 会兜底为空串，
// 上游永远 stream=true，网关消费 SSE 后返回 response.completed.response 作为 JSON。
// 提取 output[].content[].text 打印模型回答。**会消耗一次上游额度**。
import { parseEnv } from "../utils/env.js";
import { callJson } from "../utils/http.js";
import { fail, info, ok, section, truncate } from "../utils/print.js";

const PROMPT = "用一句话回答：现在能正常调用上游吗？";

export async function runResponsesCheck(): Promise<void> {
  section("POST /v1/responses（非流式）");
  const cfg = parseEnv(process.env);
  info(`model alias: ${cfg.modelAlias}`);
  info(`prompt: ${PROMPT}`);

  // 故意不发 instructions：模拟"什么都不知道的 OpenAI 兼容客户端"，
  // 由网关侧 normalize 兜底为空串（CLIProxyAPI 同款行为）
  const res = await callJson(cfg, "POST", "/v1/responses", {
    model: cfg.modelAlias,
    input: PROMPT,
    stream: false,
  });

  if (res.status !== 200) {
    fail(
      "/v1/responses HTTP 状态码",
      `期望 200，实际 ${res.status}：${truncate(res.text, 400)}`,
    );
  }

  let payload: unknown;
  try {
    payload = res.json();
  } catch (error) {
    fail("/v1/responses 响应不是 JSON", String(error));
  }

  const text = extractOutputText(payload);
  if (text) {
    info(`输出文本：${truncate(text, 400)}`);
  } else {
    info(`响应正文摘要：${truncate(JSON.stringify(payload), 400)}`);
  }
  ok("/v1/responses 返回 200 且正文为 JSON");
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const seg of content) {
      if (!seg || typeof seg !== "object") continue;
      const segText = (seg as { text?: unknown }).text;
      if (typeof segText === "string" && segText.length > 0) {
        parts.push(segText);
      }
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runResponsesCheck().catch((error) => {
    fail("非流式调用抛错", error instanceof Error ? error.message : String(error));
  });
}
