/**
 * Codex OAuth Device Code Flow
 *
 * 不依赖本机 callback server，适合 headless server / SSH / devcontainer
 * 端口转发不通的场景。流程见 src/config/codex-upstream.ts 顶部注释。
 *
 * 与 loopback callback flow 的边界划分：
 *   - 本文件只负责前两步（usercode 请求 + 轮询 token）
 *   - 第三步（用 authorization_code 换 access/refresh token）复用 oauth.ts
 *     的 exchangeAuthorizationCode（PKCE 用服务器返回的、不再客户端生成）
 */

const ERROR_BODY_MAX = 200;
const FALLBACK_INTERVAL_MS = 5_000;
const PENDING_STATUSES = new Set([403, 404]);

export type DeviceUserCodeRequestParams = {
  fetchFn?: typeof fetch;
  baseUrl: string;
  usercodePath: string;
  clientId: string;
};

export type DeviceUserCodeResult = {
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
};

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseObjectBody(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseIntervalMs(value: unknown): number {
  // 上游有时给数字、有时给字符串数字（CLIProxyAPI codex_device.go:235-247 双解析）
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value * 1000;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed * 1000;
    }
  }
  return FALLBACK_INTERVAL_MS;
}

export async function requestDeviceUserCode(
  params: DeviceUserCodeRequestParams,
): Promise<DeviceUserCodeResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const url = `${params.baseUrl.replace(/\/$/, "")}${params.usercodePath}`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: params.clientId }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `device_usercode_failed: HTTP ${response.status} ${text.slice(0, ERROR_BODY_MAX)}`,
    );
  }
  const body = parseObjectBody(text);
  if (!body) {
    throw new Error("device_usercode_invalid_response");
  }
  const deviceAuthId = nonEmptyString(body.device_auth_id);
  // CLIProxyAPI 同款防御：上游有时返回 user_code，有时返回 usercode
  const userCode = nonEmptyString(body.user_code) ?? nonEmptyString(body.usercode);
  if (!deviceAuthId || !userCode) {
    throw new Error("device_usercode_missing_fields");
  }
  return { deviceAuthId, userCode, intervalMs: parseIntervalMs(body.interval) };
}

export type PollDeviceTokenParams = {
  fetchFn?: typeof fetch;
  baseUrl: string;
  pollPath: string;
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
  timeoutMs: number;
  // 注入式时钟，便于测试不真的 sleep
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type PollDeviceTokenResult = {
  authorizationCode: string;
  codeVerifier: string;
  codeChallenge: string;
};

export async function pollDeviceToken(
  params: PollDeviceTokenParams,
): Promise<PollDeviceTokenResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const now = params.now ?? Date.now;
  const sleep =
    params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${params.baseUrl.replace(/\/$/, "")}${params.pollPath}`;
  const deadline = now() + params.timeoutMs;
  while (true) {
    if (now() >= deadline) {
      throw new Error("device_auth_timeout");
    }
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        device_auth_id: params.deviceAuthId,
        user_code: params.userCode,
      }),
    });
    const text = await response.text();
    if (response.ok) {
      const body = parseObjectBody(text);
      if (!body) {
        throw new Error("device_token_invalid_response");
      }
      const authorizationCode = nonEmptyString(body.authorization_code);
      const codeVerifier = nonEmptyString(body.code_verifier);
      const codeChallenge = nonEmptyString(body.code_challenge);
      if (!authorizationCode || !codeVerifier || !codeChallenge) {
        throw new Error("device_token_missing_fields");
      }
      return { authorizationCode, codeVerifier, codeChallenge };
    }
    if (PENDING_STATUSES.has(response.status)) {
      // 还没授权，等到下个 interval 再试。终止条件由循环顶端 deadline 检查负责。
      await sleep(params.intervalMs);
      continue;
    }
    throw new Error(
      `device_poll_failed: HTTP ${response.status} ${text.slice(0, ERROR_BODY_MAX)}`,
    );
  }
}
