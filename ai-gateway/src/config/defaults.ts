import type { GatewayConfig } from "./types.js";
import {
  OPENAI_AUTH_BASE_URL,
  OPENAI_CODEX_AUTHORIZE_EXTRA_PARAMS,
  OPENAI_CODEX_AUTHORIZE_PATH,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_DEVICE_DEFAULT_POLL_INTERVAL_S,
  OPENAI_CODEX_DEVICE_REDIRECT_URI,
  OPENAI_CODEX_DEVICE_TIMEOUT_MS,
  OPENAI_CODEX_DEVICE_TOKEN_PATH,
  OPENAI_CODEX_DEVICE_USERCODE_PATH,
  OPENAI_CODEX_DEVICE_VERIFICATION_URL,
  OPENAI_CODEX_REDIRECT_URI,
  OPENAI_CODEX_RESPONSES_BASE_URL,
  OPENAI_CODEX_SCOPE,
  OPENAI_CODEX_TOKEN_PATH,
} from "./codex-upstream.js";

export const DEFAULT_CONFIG: GatewayConfig = {
  version: 1,
  defaultModelAlias: "codex-default",
  models: {
    "codex-default": {
      provider: "openai-codex",
      upstreamModel: "gpt-5.3-codex",
    },
  },
  server: {
    host: "127.0.0.1",
    port: 8787,
    maxConcurrency: 4,
    cooldownMs: 30_000,
  },
};

// 派生自 codex-upstream.ts 的单一信源；改任一字段前先看 docs/UPSTREAM-SYNC.md
export const OPENAI_CODEX_OAUTH_DEFAULTS = {
  authBaseUrl: OPENAI_AUTH_BASE_URL,
  authorizePath: OPENAI_CODEX_AUTHORIZE_PATH,
  tokenPath: OPENAI_CODEX_TOKEN_PATH,
  clientId: OPENAI_CODEX_CLIENT_ID,
  redirectUri: OPENAI_CODEX_REDIRECT_URI,
  scope: OPENAI_CODEX_SCOPE,
  extraParams: OPENAI_CODEX_AUTHORIZE_EXTRA_PARAMS,
};

// Device code 模式：第二阶段 token exchange 复用 OPENAI_CODEX_OAUTH_DEFAULTS.tokenPath，
// 但 redirect_uri 必须用 deviceauth/callback 字面量。
export const OPENAI_CODEX_OAUTH_DEVICE_DEFAULTS = {
  authBaseUrl: OPENAI_AUTH_BASE_URL,
  usercodePath: OPENAI_CODEX_DEVICE_USERCODE_PATH,
  pollPath: OPENAI_CODEX_DEVICE_TOKEN_PATH,
  verificationUrl: OPENAI_CODEX_DEVICE_VERIFICATION_URL,
  redirectUri: OPENAI_CODEX_DEVICE_REDIRECT_URI,
  tokenExchangePath: OPENAI_CODEX_TOKEN_PATH,
  clientId: OPENAI_CODEX_CLIENT_ID,
  defaultPollIntervalS: OPENAI_CODEX_DEVICE_DEFAULT_POLL_INTERVAL_S,
  timeoutMs: OPENAI_CODEX_DEVICE_TIMEOUT_MS,
};

export { OPENAI_CODEX_RESPONSES_BASE_URL };
