export interface SmokeConfig {
  baseUrl: string;
  apiToken?: string;
  modelAlias: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_MODEL_ALIAS = "codex-default";

export function parseEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): SmokeConfig {
  const rawBaseUrl = env.AI_GATEWAY_BASE_URL?.trim();
  const baseUrl = rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : DEFAULT_BASE_URL;

  const rawToken = env.AI_GATEWAY_API_TOKEN?.trim();
  const apiToken = rawToken ? rawToken : undefined;

  const rawAlias = env.AI_GATEWAY_MODEL_ALIAS?.trim();
  const modelAlias = rawAlias && rawAlias.length > 0 ? rawAlias : DEFAULT_MODEL_ALIAS;

  return { baseUrl, apiToken, modelAlias };
}

function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`AI_GATEWAY_BASE_URL 不是合法 URL：${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`AI_GATEWAY_BASE_URL 协议必须是 http/https：${raw}`);
  }
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed;
}
