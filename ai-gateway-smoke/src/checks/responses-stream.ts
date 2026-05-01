// check:responses:stream
// 调 POST /v1/responses（stream: true），网关直接透传上游 SSE。
// 用 SseChunkSplitter 按 \n\n 边界拆事件；逐 chunk 打印字节数与事件预览。
// 验证流式路径上 chunk 切分、事件完整性、模型 delta 逐字下发。
// **会消耗一次上游额度**。
import { parseEnv } from "../utils/env.js";
import { openStream } from "../utils/http.js";
import { SseChunkSplitter } from "../utils/sse.js";
import { fail, info, ok, section, truncate } from "../utils/print.js";

const PROMPT = "用一句话回答：现在能正常调用上游吗？";

export async function runResponsesStreamCheck(): Promise<void> {
  section("POST /v1/responses（流式 SSE）");
  const cfg = parseEnv(process.env);
  info(`model alias: ${cfg.modelAlias}`);
  info(`prompt: ${PROMPT}`);

  // 故意不发 instructions，由网关侧 normalize 兜底
  const res = await openStream(cfg, "/v1/responses", {
    model: cfg.modelAlias,
    input: PROMPT,
    stream: true,
  });

  if (res.status !== 200) {
    const body = await res.text();
    fail(
      "/v1/responses 流式 HTTP 状态码",
      `期望 200，实际 ${res.status}：${truncate(body, 400)}`,
    );
  }
  if (!res.body) {
    fail("/v1/responses 流式响应没有 body");
  }

  const splitter = new SseChunkSplitter();
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let chunkIndex = 0;
  let eventCount = 0;
  let totalBytes = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunkIndex += 1;
    totalBytes += value.byteLength;
    const text = decoder.decode(value, { stream: true });
    const events = splitter.push(text);
    info(`chunk #${chunkIndex} 字节=${value.byteLength} 拆出事件=${events.length}`);
    for (const ev of events) {
      eventCount += 1;
      info(`  [事件 ${eventCount}] ${truncate(ev.replace(/\n/g, " | "), 200)}`);
    }
  }

  const remainder = splitter.flush();
  if (remainder !== null) {
    info(`flush 剩余片段：${truncate(remainder.replace(/\n/g, " | "), 200)}`);
  }

  if (eventCount === 0) {
    fail("流式响应未产生任何 SSE 事件", `共收到 ${chunkIndex} 个 chunk / ${totalBytes} 字节`);
  }

  ok(`流式 SSE 共 ${chunkIndex} chunk / ${totalBytes} 字节 / ${eventCount} 事件`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runResponsesStreamCheck().catch((error) => {
    fail("流式调用抛错", error instanceof Error ? error.message : String(error));
  });
}
