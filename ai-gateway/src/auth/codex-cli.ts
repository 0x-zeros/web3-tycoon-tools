import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { OAuthCredentialProfile } from "./types.js";
import { resolveJwtAccountId, resolveJwtEmail, resolveJwtExpiryIso } from "./jwt.js";

// access_token 不是 JWT 或缺 exp 时的兜底过期时间偏移；
// 1 小时后由 Task 7 token refresh 流程主动刷新即可。
const FALLBACK_EXPIRY_MS = 60 * 60_000;

export type CodexCliCredential = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  accountId: string | null;
  email: string | null;
  sourcePath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function resolveCodexCliAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  const codexHome = nonEmptyString(env.CODEX_HOME) ?? path.join(os.homedir(), ".codex");
  return path.join(codexHome, "auth.json");
}

export async function readCodexCliAuthJson(env: NodeJS.ProcessEnv = process.env): Promise<CodexCliCredential | null> {
  const sourcePath = resolveCodexCliAuthPath(env);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new Error(`读取 Codex CLI auth.json 失败: ${sourcePath}`, { cause: error });
  }

  const tokens = isRecord(parsed) && isRecord(parsed.tokens) ? parsed.tokens : null;
  const accessToken = nonEmptyString(tokens?.access_token);
  const refreshToken = nonEmptyString(tokens?.refresh_token);
  if (!accessToken || !refreshToken) {
    return null;
  }

  const expiresAt = resolveJwtExpiryIso(accessToken) ?? new Date(Date.now() + FALLBACK_EXPIRY_MS).toISOString();
  const accountIdFromFile = nonEmptyString(tokens?.account_id);

  return {
    accessToken,
    refreshToken,
    expiresAt,
    accountId: accountIdFromFile ?? resolveJwtAccountId(accessToken),
    email: resolveJwtEmail(accessToken),
    sourcePath,
  };
}

export function toImportedCodexProfile(credential: CodexCliCredential): OAuthCredentialProfile {
  return {
    type: "oauth",
    provider: "openai-codex",
    source: {
      mode: "codex-cli-imported",
      importedFrom: credential.sourcePath,
      importedAt: new Date().toISOString(),
    },
    account: {
      accountId: credential.accountId,
      email: credential.email,
    },
    tokens: {
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken,
      expiresAt: credential.expiresAt,
    },
    lastRefresh: {
      status: "never",
      at: null,
      errorCode: null,
      message: null,
    },
  };
}
