// check:health
// 调 GET /health，断言 200 + {ok: true}。不触达上游模型，仅验证网关进程活着。
import { parseEnv } from "../utils/env.js";
import { callJson } from "../utils/http.js";
import { fail, ok, section, truncate } from "../utils/print.js";

export async function runHealthCheck(): Promise<void> {
  section("GET /health");
  const cfg = parseEnv(process.env);
  const res = await callJson(cfg, "GET", "/health");
  if (res.status !== 200) {
    fail("健康检查 HTTP 状态码", `期望 200，实际 ${res.status}：${truncate(res.text)}`);
  }
  let payload: { ok?: boolean };
  try {
    payload = res.json<{ ok?: boolean }>();
  } catch (error) {
    fail("健康检查响应不是 JSON", String(error));
  }
  if (payload.ok !== true) {
    fail("健康检查 ok 字段", `期望 true，实际 ${JSON.stringify(payload)}`);
  }
  ok("/health 返回 200 + {ok:true}");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHealthCheck().catch((error) => {
    fail("健康检查抛错", error instanceof Error ? error.message : String(error));
  });
}
