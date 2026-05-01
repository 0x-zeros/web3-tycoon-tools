/**
 * Codex /responses 转发体。我们不再做严格白名单，所以保留 index signature
 * 让任意 OpenAI Responses API 字段（tools / reasoning / parallel_tool_calls 等）
 * 都能携带过去。
 */
export type ResponsesRequestBody = {
  model?: string;
  input?: unknown;
  stream?: boolean;
  instructions?: string | null;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};
