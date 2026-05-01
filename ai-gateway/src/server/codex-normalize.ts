import {
  CODEX_BODY_FIELDS_TO_DELETE,
  CODEX_BUILTIN_TOOL_ALIASES,
  CODEX_FORCED_BODY_FIELDS,
  CODEX_INPUT_ROLE_REWRITE,
  CODEX_INSTRUCTIONS_FALLBACK,
  CODEX_SERVICE_TIER_KEEP,
  CODEX_USER_INPUT_TEMPLATE_PART_TYPE,
  CODEX_USER_INPUT_TEMPLATE_ROLE,
  CODEX_USER_INPUT_TEMPLATE_TYPE,
} from "../config/codex-upstream.js";
import type { ResponsesRequestBody } from "./types.js";

/**
 * 把客户端的 OpenAI Responses API 请求体规范化成 Codex 上游能接受的形态。
 * 步骤参 CLIProxyAPI internal/translator/codex/openai/responses/codex_openai-responses_request.go：
 *
 *   1. 字符串 input → message 数组（Codex 不接受字符串 input）
 *   2. 删除 11 个 Codex 不接受的字段（temperature/top_p/max_output_tokens 等）
 *   3. service_tier 仅保留 "priority"，其他值删除
 *   4. instructions 缺失或 null 时兜底为空串
 *   5. 强制注入 stream=true / store=false / parallel_tool_calls=true /
 *      include=["reasoning.encrypted_content"]
 *   6. input array 中 role:"system" → "developer"
 *   7. tools[].type 与 tool_choice.type 的旧别名（如 web_search_preview）
 *      归一到上游接受的稳定名（web_search）
 */
export function normalizeCodexRequestBody(input: Record<string, unknown>): ResponsesRequestBody {
  let body: Record<string, unknown> = { ...input };

  // 1. 字符串 input → message 数组
  if (typeof body.input === "string") {
    body.input = [
      {
        type: CODEX_USER_INPUT_TEMPLATE_TYPE,
        role: CODEX_USER_INPUT_TEMPLATE_ROLE,
        content: [{ type: CODEX_USER_INPUT_TEMPLATE_PART_TYPE, text: body.input }],
      },
    ];
  }

  // 2. 删除 Codex 不接受的字段
  for (const field of CODEX_BODY_FIELDS_TO_DELETE) {
    delete body[field];
  }

  // 3. service_tier 仅保留 priority
  if ("service_tier" in body && body.service_tier !== CODEX_SERVICE_TIER_KEEP) {
    delete body.service_tier;
  }

  // 4. instructions 兜底
  if (typeof body.instructions !== "string") {
    body.instructions = CODEX_INSTRUCTIONS_FALLBACK;
  }

  // 5. 强制注入字段（覆盖客户端值）
  body = { ...body, ...CODEX_FORCED_BODY_FIELDS };

  // 6. input array role 改写
  if (Array.isArray(body.input)) {
    body.input = body.input.map((item) => {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).role === "string"
      ) {
        const original = (item as Record<string, unknown>).role as string;
        const rewritten = CODEX_INPUT_ROLE_REWRITE[original];
        if (rewritten) {
          return { ...(item as Record<string, unknown>), role: rewritten };
        }
      }
      return item;
    });
  }

  // 7. tool 类型别名归一
  if (Array.isArray(body.tools)) {
    body.tools = body.tools.map(rewriteToolType);
  }
  if (
    body.tool_choice !== null &&
    typeof body.tool_choice === "object" &&
    !Array.isArray(body.tool_choice)
  ) {
    body.tool_choice = rewriteToolType(body.tool_choice as Record<string, unknown>);
  }

  return body as ResponsesRequestBody;
}

function rewriteToolType(item: unknown): unknown {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return item;
  }
  const obj = item as Record<string, unknown>;
  if (typeof obj.type === "string") {
    const alias = CODEX_BUILTIN_TOOL_ALIASES[obj.type];
    if (alias) {
      return { ...obj, type: alias };
    }
  }
  return obj;
}
