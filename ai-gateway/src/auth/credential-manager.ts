import path from "node:path";
import type { GatewayPaths } from "../util/home.js";
import { withFileLock, type FileLockOptions } from "../util/file-lock.js";
import { isUsableUntil, systemClock, type Clock } from "../util/time.js";
import type { CodexRefreshFunction } from "../providers/types.js";
import { createEmptyCredentialStore, loadCredentialStore, saveCredentialStore } from "./credential-store.js";
import { DEFAULT_PROFILE_ID, type OAuthCredentialProfile } from "./types.js";

const REFRESH_MARGIN_MS = 5 * 60_000;
const REFRESH_RPC_TIMEOUT_MS = 60_000;
const FAILED_MESSAGE_MAX = 500;
const CREDENTIAL_LOCK: Partial<FileLockOptions> = { staleMs: 30_000, retryMs: 25, timeoutMs: 10_000 };
const REFRESH_LOCK: Partial<FileLockOptions> = { staleMs: 180_000, retryMs: 50, timeoutMs: 180_000 };

const REUSE_TOKEN_RE = /\brefresh_token_reused\b/;
const REUSE_PHRASE_RE = /already been used to generate a new access token/i;

export function isRefreshTokenReusedError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return REUSE_TOKEN_RE.test(message) || REUSE_PHRASE_RE.test(message);
}

export class AuthUnavailableError extends Error {
  readonly code = "auth_unavailable";
}

export type CredentialManagerParams = {
  paths: GatewayPaths;
  refreshToken: CodexRefreshFunction;
  now?: Clock;
  // 单次 refresh RPC 调用的本地超时；超时后 Promise.race 抛错，
  // 让 refresh.lock 立即释放，避免任何挂死的 refresh 实现把进程拖死。
  // 注意：fetch 的 socket 仍会泄漏到 OS 关闭为止，长期方案是 Task 8
  // 的 codex provider 在签名上接受 AbortSignal 并传给 fetch。
  refreshTimeoutMs?: number;
};

export type AuthContext = {
  accessToken: string;
  /** chatgpt account id；OAuth 模式下由 src/auth/jwt.ts resolveJwtAccountId 解出，
   *  import-codex-cli 模式下从 auth.json 直接读。
   *  缺失时为 null（实际上 OpenAI 都会返回，但兜底防御）。 */
  accountId: string | null;
};

export class CredentialManager {
  private refreshPromise: Promise<string> | null = null;

  constructor(private readonly params: CredentialManagerParams) {}

  async getAccessToken(): Promise<string> {
    return (await this.getAuthContext()).accessToken;
  }

  async getAuthContext(): Promise<AuthContext> {
    const store = await loadCredentialStore(this.params.paths);
    const profile = store.profiles[store.activeProfileId];
    if (!profile) {
      throw new AuthUnavailableError("尚未登录，请先执行 auth login");
    }
    // accountId 不会因 refresh 变化（refresh 只换 token，不动 account 信息），
    // 在这里一次性快照即可。
    const accountId = profile.account.accountId;
    const now = (this.params.now ?? systemClock)();
    if (isUsableUntil(profile.tokens.expiresAt, now, REFRESH_MARGIN_MS)) {
      return { accessToken: profile.tokens.accessToken, accountId };
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshUnderQueue().finally(() => {
        this.refreshPromise = null;
      });
    }
    const accessToken = await this.refreshPromise;
    return { accessToken, accountId };
  }

  private async refreshUnderQueue(): Promise<string> {
    const refreshLockPath = path.join(this.params.paths.locksDir, "openai-codex-default.refresh.lock");
    const credentialLockPath = path.join(this.params.paths.locksDir, "credentials.lock");
    return await withFileLock(refreshLockPath, REFRESH_LOCK, async () =>
      withFileLock(credentialLockPath, CREDENTIAL_LOCK, async () => this.refreshWithFreshDiskRead()),
    );
  }

  private async refreshWithFreshDiskRead(): Promise<string> {
    const store = await loadCredentialStore(this.params.paths);
    const profile = store.profiles[store.activeProfileId];
    if (!profile) {
      throw new AuthUnavailableError("尚未登录，请先执行 auth login");
    }
    const now = (this.params.now ?? systemClock)();
    if (isUsableUntil(profile.tokens.expiresAt, now, REFRESH_MARGIN_MS)) {
      return profile.tokens.accessToken;
    }
    try {
      const refreshed = await this.callRefreshWithTimeout(profile.tokens.refreshToken);
      const nextProfile: OAuthCredentialProfile = {
        ...profile,
        tokens: {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
        },
        lastRefresh: {
          status: "success",
          at: now.toISOString(),
          errorCode: null,
          message: null,
        },
      };
      const nextStore = createEmptyCredentialStore();
      nextStore.profiles[DEFAULT_PROFILE_ID] = nextProfile;
      await saveCredentialStore(this.params.paths, nextStore);
      return refreshed.accessToken;
    } catch (error) {
      if (isRefreshTokenReusedError(error)) {
        const winner = await loadCredentialStore(this.params.paths);
        const winnerProfile = winner.profiles[winner.activeProfileId];
        if (winnerProfile && isUsableUntil(winnerProfile.tokens.expiresAt, now, REFRESH_MARGIN_MS)) {
          return winnerProfile.tokens.accessToken;
        }
      }
      try {
        await this.persistFailedRefresh(error, now);
      } catch {
        // 持久化 lastRefresh 自身失败（磁盘错误、JSON 损坏等）时不应吞掉原 refresh 错误。
      }
      throw error;
    }
  }

  private async callRefreshWithTimeout(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  }> {
    const timeoutMs = this.params.refreshTimeoutMs ?? REFRESH_RPC_TIMEOUT_MS;
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        this.params.refreshToken(refreshToken),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`refresh_rpc_timeout: ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async persistFailedRefresh(error: unknown, now: Date): Promise<void> {
    const failed = await loadCredentialStore(this.params.paths);
    const failedProfile = failed.profiles[failed.activeProfileId];
    if (!failedProfile) {
      return;
    }
    const rawMessage = error instanceof Error ? error.message : String(error);
    failedProfile.lastRefresh = {
      status: "failed",
      at: now.toISOString(),
      errorCode: isRefreshTokenReusedError(error) ? "refresh_token_reused" : "refresh_failed",
      message: rawMessage.slice(0, FAILED_MESSAGE_MAX),
    };
    await saveCredentialStore(this.params.paths, failed);
  }
}
