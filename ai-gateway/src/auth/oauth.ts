import http from "node:http";
import type { GatewayPaths } from "../util/home.js";
import { resolveJwtAccountId, resolveJwtEmail, resolveJwtExpiryIso } from "./jwt.js";
import { createEmptyCredentialStore, saveCredentialStore } from "./credential-store.js";
import { DEFAULT_PROFILE_ID } from "./types.js";

const FALLBACK_EXPIRY_MS = 60 * 60_000;
const ERROR_BODY_MAX = 200;
const CALLBACK_DESCRIPTION_MAX = 200;

export type BuildAuthorizeUrlParams = {
  authBaseUrl: string;
  authorizePath: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  challenge: string;
  state: string;
  /**
   * 透传到 authorize URL 的额外 query 参数。
   * Codex 必备：prompt=login, id_token_add_organizations=true, codex_cli_simplified_flow=true
   * 缺这些 OpenAI auth 返回 unknown_error。来源见 src/config/codex-upstream.ts。
   */
  extraParams?: Readonly<Record<string, string>>;
};

export type TokenExchangeParams = {
  fetchFn?: typeof fetch;
  tokenUrl: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
};

export type TokenExchangeResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  accountId: string | null;
  email: string | null;
};

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function buildAuthorizeUrl(params: BuildAuthorizeUrlParams): URL {
  const url = new URL(params.authorizePath, params.authBaseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  if (params.scope.trim()) {
    url.searchParams.set("scope", params.scope);
  }
  if (params.extraParams) {
    for (const [key, value] of Object.entries(params.extraParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

export function parseCallbackUrl(rawUrl: string, expectedState: string): { code: string } {
  const url = new URL(rawUrl);
  const error = url.searchParams.get("error");
  if (error) {
    const description = url.searchParams.get("error_description");
    if (description) {
      // 上游 description 由 OAuth provider / 中间人控制，截断 + 去掉换行/回车
      // 防止日志多行注入。
      const sanitized = description.replace(/[\r\n]+/g, " ").slice(0, CALLBACK_DESCRIPTION_MAX);
      throw new Error(`${error}: ${sanitized}`);
    }
    throw new Error(error);
  }
  const state = url.searchParams.get("state");
  if (state !== expectedState) {
    throw new Error("state mismatch");
  }
  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error("missing authorization code");
  }
  return { code };
}

export async function exchangeAuthorizationCode(params: TokenExchangeParams): Promise<TokenExchangeResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(params.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      code_verifier: params.codeVerifier,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `oauth_token_exchange_failed: HTTP ${response.status} ${bodyText.slice(0, ERROR_BODY_MAX)}`,
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    throw new Error("oauth_token_exchange_invalid_response");
  }

  const accessToken = nonEmptyString(body.access_token);
  const refreshToken = nonEmptyString(body.refresh_token);
  if (!accessToken || !refreshToken) {
    throw new Error("oauth_token_exchange_missing_tokens");
  }
  // CLIProxyAPI 用 id_token 解 accountId/email（chatgpt_account_id claim 在 id_token 中更稳定）；
  // 没拿到 id_token 时回退到 access_token，与之前行为兼容。
  const idToken = nonEmptyString(body.id_token);
  const identityToken = idToken ?? accessToken;

  const expiresIn = positiveFiniteNumber(body.expires_in);
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : (resolveJwtExpiryIso(accessToken) ?? new Date(Date.now() + FALLBACK_EXPIRY_MS).toISOString());

  return {
    accessToken,
    refreshToken,
    expiresAt,
    accountId: resolveJwtAccountId(identityToken),
    email: resolveJwtEmail(identityToken),
  };
}

export type WaitForLocalCallbackParams = {
  port: number;
  path: string;
  expectedState: string;
  timeoutMs: number;
};

/**
 * 启动本地 OAuth callback 接收 server，等浏览器把 authorize code 发回来。
 *
 * 双栈绑定：同时 listen 在 127.0.0.1（IPv4 loopback）和 ::1（IPv6 loopback）。
 * 浏览器把 `localhost` 解析到 ::1 时也能正确接到 callback，避免之前只绑
 * 127.0.0.1 时部分系统连接失败的问题。
 *
 * 失败兜底：若 IPv6 listener 起不来（部分系统没启用 IPv6），不报错，继续
 * 用 IPv4 listener。仅当 IPv4 也起不来时才整体 reject。
 */
export async function waitForLocalCallback(params: WaitForLocalCallbackParams): Promise<{ code: string }> {
  return await new Promise<{ code: string }>((resolve, reject) => {
    let settled = false;
    // 所有响应统一带这个 header：HTTP/1.1 默认 keep-alive 会让 socket 在响应后继续待命，
    // server.close() 不会主动断 idle 连接，CLI 就在 "OAuth 登录完成" 之后挂住等到 keep-alive
    // 超时（浏览器侧默认 ~5min）才退出。显式 Connection: close 让 Node http 在 res.end()
    // flush 后立刻关 socket，server.close() 才能立即返回，run() 也才能正常返回让进程退出。
    const closeHeaders = { "content-type": "text/plain; charset=utf-8", connection: "close" };
    const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
      const requestPath = (req.url ?? "/").split("?", 1)[0];
      if (requestPath !== params.path) {
        // 浏览器对监听端口的投机性请求（favicon.ico 等）不应破坏整条 OAuth 流。
        res.writeHead(404, { connection: "close" }).end();
        return;
      }
      if (settled) {
        res.writeHead(503, { connection: "close" }).end();
        return;
      }
      try {
        // parseCallbackUrl 只看 search params，host 不影响结果，写啥都行
        const parsed = parseCallbackUrl(
          `http://localhost:${params.port}${req.url ?? ""}`,
          params.expectedState,
        );
        res.writeHead(200, closeHeaders);
        res.end("登录完成，可以关闭此页面。");
        settle(() => resolve(parsed));
      } catch (error) {
        res.writeHead(400, closeHeaders);
        res.end("OAuth 回调无效。");
        settle(() => reject(error));
      }
    };

    const v4Server = http.createServer(handler);
    const v6Server = http.createServer(handler);

    const timer = setTimeout(() => settle(() => reject(new Error("oauth_callback_timeout"))), params.timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      v4Server.removeAllListeners("error");
      v6Server.removeAllListeners("error");
      v4Server.close();
      v6Server.close();
    };
    function settle(action: () => void): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      action();
    }

    // IPv4 是主路径——失败直接 reject（端口被占等）
    v4Server.once("error", (err) => settle(() => reject(err)));
    // IPv6 是辅助路径——失败静默（系统可能没启用 IPv6 或 ::1 不可达），
    // 不影响 IPv4 listener 继续工作
    v6Server.once("error", () => {
      // 主动把 v6Server 关掉避免后续 cleanup 报错
      v6Server.close();
    });

    v4Server.listen(params.port, "127.0.0.1");
    v6Server.listen(params.port, "::1");
  });
}

export type CompleteOAuthLoginParams = TokenExchangeParams & {
  paths: GatewayPaths;
};

export async function completeOAuthLoginWithCode(params: CompleteOAuthLoginParams): Promise<void> {
  const exchanged = await exchangeAuthorizationCode(params);
  const store = createEmptyCredentialStore();
  store.profiles[DEFAULT_PROFILE_ID] = {
    type: "oauth",
    provider: "openai-codex",
    source: { mode: "gateway-oauth", importedFrom: null, importedAt: null },
    account: { accountId: exchanged.accountId, email: exchanged.email },
    tokens: {
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      expiresAt: exchanged.expiresAt,
    },
    lastRefresh: { status: "never", at: null, errorCode: null, message: null },
  };
  await saveCredentialStore(params.paths, store);
}
