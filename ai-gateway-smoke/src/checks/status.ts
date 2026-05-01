// check:status
// 调 GET /status，打印 auth / models / provider 三段；用敏感串扫描器扫整个
// 响应文本（命中 eyJ JWT 头 / "Bearer " 前缀 / 自定义敏感串则失败）。
// 不触达上游模型；仅验证网关元数据正确且不泄漏 token。
import { parseEnv } from "../utils/env.js";
import { callJson } from "../utils/http.js";
import { scanSensitive } from "../utils/sensitive.js";
import { fail, info, ok, section, truncate } from "../utils/print.js";

interface StatusPayload {
  auth?: {
    loggedIn?: boolean;
    sourceMode?: string;
    email?: string | null;
    expiresAt?: string | null;
  };
  models?: string[];
  defaultModelAlias?: string;
  provider?: {
    activeRequests?: number;
    cooldownUntil?: string | null;
    maxConcurrency?: number;
  };
}

export async function runStatusCheck(): Promise<void> {
  section("GET /status");
  const cfg = parseEnv(process.env);
  const res = await callJson(cfg, "GET", "/status");
  if (res.status !== 200) {
    fail("状态接口 HTTP 状态码", `期望 200，实际 ${res.status}：${truncate(res.text)}`);
  }

  const scan = scanSensitive(res.text);
  if (scan.found) {
    fail(
      "状态接口响应包含敏感字符串",
      `命中：${scan.matches.slice(0, 3).join(", ")}`,
    );
  }

  let payload: StatusPayload;
  try {
    payload = res.json<StatusPayload>();
  } catch (error) {
    fail("状态接口响应不是 JSON", String(error));
  }

  const auth = payload.auth ?? {};
  info(
    `auth: loggedIn=${auth.loggedIn ?? "?"} sourceMode=${auth.sourceMode ?? "?"} ` +
      `email=${auth.email ?? "(无)"} expiresAt=${auth.expiresAt ?? "(无)"}`,
  );

  if (!Array.isArray(payload.models) || payload.models.length === 0) {
    fail("状态接口 models 字段", `期望非空数组，实际 ${JSON.stringify(payload.models)}`);
  }
  info(`models: [${payload.models.join(", ")}] 默认 ${payload.defaultModelAlias ?? "(无)"}`);

  const provider = payload.provider ?? {};
  info(
    `provider: activeRequests=${provider.activeRequests ?? "?"} ` +
      `cooldownUntil=${provider.cooldownUntil ?? "(无)"} ` +
      `maxConcurrency=${provider.maxConcurrency ?? "?"}`,
  );

  ok("/status 通过敏感串扫描，三段字段齐全");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStatusCheck().catch((error) => {
    fail("状态检查抛错", error instanceof Error ? error.message : String(error));
  });
}
