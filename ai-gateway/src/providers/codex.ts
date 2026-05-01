import { randomUUID } from "node:crypto";
import {
  CODEX_ACCEPT_JSON,
  CODEX_ACCEPT_STREAM,
  CODEX_CONNECTION,
  CODEX_ORIGINATOR,
  CODEX_USER_AGENT,
} from "../config/codex-upstream.js";
import type { ResponsesRequestBody } from "../server/types.js";
import type { RefreshTokenResult } from "./types.js";

const DEFAULT_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const DEFAULT_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_FALLBACK_EXPIRES_IN_S = 3600;
const ERROR_BODY_MAX = 200;

export class ProviderCooldownError extends Error {
  readonly code = "upstream_cooldown";
  constructor(message = "upstream_cooldown") {
    super(message);
    this.name = "ProviderCooldownError";
  }
}

export class LocalConcurrencyLimitedError extends Error {
  readonly code = "local_concurrency_limited";
  constructor(message = "local_concurrency_limited") {
    super(message);
    this.name = "LocalConcurrencyLimitedError";
  }
}

export type CodexProviderParams = {
  baseUrl: string;
  fetchFn?: typeof fetch;
  maxConcurrency: number;
  cooldownMs: number;
};

export type CodexProviderStatus = {
  activeRequests: number;
  cooldownUntil: string | null;
  maxConcurrency: number;
};

export class CodexProvider {
  private activeRequests = 0;
  private cooldownUntil = 0;

  constructor(private readonly params: CodexProviderParams) {}

  status(): CodexProviderStatus {
    return {
      activeRequests: this.activeRequests,
      cooldownUntil: this.cooldownUntil > Date.now() ? new Date(this.cooldownUntil).toISOString() : null,
      maxConcurrency: this.params.maxConcurrency,
    };
  }

  async createResponse(params: {
    accessToken: string;
    upstreamModel: string;
    body: ResponsesRequestBody;
    /** OAuth 模式下的 chatgpt account id，写入 Chatgpt-Account-Id 头；
     *  缺失（null/undefined）时不写该头。 */
    accountId?: string | null;
    /** 客户端期望流式响应。决定 Accept 头：true=text/event-stream，false=application/json。
     *  注意：Codex 上游永远以 SSE 形式响应；此参数只控制 Accept 协商，
     *  上游 body 的 stream 字段由调用方（server/responses.ts）决定。 */
    stream?: boolean;
  }): Promise<Response> {
    if (Date.now() < this.cooldownUntil) {
      throw new ProviderCooldownError();
    }
    if (this.activeRequests >= this.params.maxConcurrency) {
      throw new LocalConcurrencyLimitedError();
    }
    this.activeRequests += 1;
    try {
      const fetchFn = this.params.fetchFn ?? fetch;
      const requestBody = { ...params.body, model: params.upstreamModel };
      const headers: Record<string, string> = {
        authorization: `Bearer ${params.accessToken}`,
        "content-type": "application/json",
        "user-agent": CODEX_USER_AGENT,
        originator: CODEX_ORIGINATOR,
        accept: params.stream ? CODEX_ACCEPT_STREAM : CODEX_ACCEPT_JSON,
        connection: CODEX_CONNECTION,
        // CLIProxyAPI codex_executor.go:783-785 仅在 UA 含 "Mac OS" 时写 Session_id；
        // 我们的 UA 永远是 codex-tui Mac OS 串，所以总是写。
        session_id: randomUUID(),
      };
      if (params.accountId) {
        headers["chatgpt-account-id"] = params.accountId;
      }
      const response = await fetchFn(`${this.params.baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
      if (response.status === 429) {
        this.cooldownUntil = Date.now() + this.params.cooldownMs;
      }
      return response;
    } finally {
      this.activeRequests -= 1;
    }
  }

  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    const fetchFn = this.params.fetchFn ?? fetch;
    const response = await fetchFn(DEFAULT_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: DEFAULT_OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        // CLIProxyAPI openai_auth.go:195 — 缺这个 scope 上游可能返回削减权限的 token
        scope: "openid profile email",
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`oauth_refresh_failed: HTTP ${response.status} ${text.slice(0, ERROR_BODY_MAX)}`);
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      throw new Error("oauth_refresh_invalid_response");
    }
    const accessToken = typeof body.access_token === "string" ? body.access_token : null;
    const nextRefreshToken = typeof body.refresh_token === "string" ? body.refresh_token : refreshToken;
    const expiresIn =
      typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0
        ? body.expires_in
        : REFRESH_FALLBACK_EXPIRES_IN_S;
    if (!accessToken) {
      throw new Error("oauth_refresh_missing_access_token");
    }
    return {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }
}
