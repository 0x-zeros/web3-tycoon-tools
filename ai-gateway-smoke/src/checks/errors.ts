// check:errors
// 触发网关三类错误并断言 error.code：
//   - unknown_model_alias：用未在 config.models 中的别名
//   - invalid_json：发非法 JSON body
//   - unauthorized：仅当设置了 AI_GATEWAY_API_TOKEN 时验证缺 Bearer 被 401
// 不触达上游模型。
import { parseEnv } from "../utils/env.js";
import { callJson, callRaw } from "../utils/http.js";
import { fail, info, ok, section, truncate } from "../utils/print.js";

interface ErrorBody {
  error?: { code?: string; message?: string };
}

export async function runErrorsCheck(): Promise<void> {
  section("/v1/responses 错误码");
  const cfg = parseEnv(process.env);

  await expectError({
    label: "未知 model alias",
    expected: "unknown_model_alias",
    run: () =>
      callJson(cfg, "POST", "/v1/responses", { model: "no-such-alias", input: "hi" }),
  });

  // 网关不再做客户端字段白名单（OpenAI Responses API 字段繁多，
  // 由上游决定哪些合法）。原"未知字段被拒绝"用例不再适用。

  await expectError({
    label: "非法 JSON",
    expected: "invalid_json",
    run: () =>
      callRaw(cfg, "POST", "/v1/responses", {
        body: "{not json",
        contentType: "application/json",
      }),
  });

  if (cfg.apiToken) {
    await expectError({
      label: "API token 缺失",
      expected: "unauthorized",
      run: () =>
        callRaw(cfg, "POST", "/v1/responses", {
          body: JSON.stringify({ model: cfg.modelAlias, input: "hi" }),
          contentType: "application/json",
          skipAuth: true,
        }),
    });
  } else {
    info("AI_GATEWAY_API_TOKEN 未设置，跳过 unauthorized 用例");
  }

  ok("错误码用例全部命中预期");
}

async function expectError(params: {
  label: string;
  expected: string;
  run: () => Promise<{ status: number; text: string; json<T>(): T }>;
}): Promise<void> {
  const res = await params.run();
  let body: ErrorBody;
  try {
    body = res.json<ErrorBody>();
  } catch (error) {
    fail(
      `${params.label}：期望 error.code=${params.expected}`,
      `响应不是 JSON：${truncate(res.text)}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
  const code = body.error?.code;
  if (code !== params.expected) {
    fail(
      `${params.label}：期望 error.code=${params.expected}`,
      `实际 status=${res.status} body=${truncate(res.text, 300)}`,
    );
  }
  info(`✓ ${params.label} → status=${res.status} code=${code}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runErrorsCheck().catch((error) => {
    fail("错误码检查抛错", error instanceof Error ? error.message : String(error));
  });
}
