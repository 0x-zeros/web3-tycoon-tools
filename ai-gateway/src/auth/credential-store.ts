import { assertSecretFilePermissions, readJsonFile, writeSecretJsonFile } from "../util/json-file.js";
import type { GatewayPaths } from "../util/home.js";
import {
  DEFAULT_PROFILE_ID,
  type CredentialSourceMode,
  type CredentialStatusSummary,
  type CredentialStore,
  type OAuthCredentialProfile,
} from "./types.js";

const SOURCE_MODES = new Set<CredentialSourceMode>(["gateway-oauth", "codex-cli-imported", "codex-cli-readonly"]);
const LAST_REFRESH_STATUSES = new Set<OAuthCredentialProfile["lastRefresh"]["status"]>([
  "never",
  "success",
  "degraded",
  "failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`credentials.json ${fieldName} 无效`);
  }
  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`credentials.json ${fieldName} 无效`);
  }
  return value;
}

function readNullableString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`credentials.json ${fieldName} 无效`);
  }
  return value;
}

function normalizeSourceMode(value: unknown, fieldName: string): CredentialSourceMode {
  if (value === undefined) {
    return "gateway-oauth";
  }
  if (typeof value !== "string") {
    throw new Error(`credentials.json ${fieldName} 无效`);
  }
  return SOURCE_MODES.has(value as CredentialSourceMode) ? (value as CredentialSourceMode) : "gateway-oauth";
}

function readSource(profileId: string, value: unknown): OAuthCredentialProfile["source"] {
  if (value !== undefined && !isRecord(value)) {
    throw new Error(`credentials.json profile ${profileId} source 无效`);
  }
  const source = isRecord(value) ? value : {};
  return {
    mode: normalizeSourceMode(source.mode, `profile ${profileId} source.mode`),
    importedFrom: readNullableString(source.importedFrom, `profile ${profileId} source.importedFrom`),
    importedAt: readNullableString(source.importedAt, `profile ${profileId} source.importedAt`),
  };
}

function readAccount(profileId: string, value: unknown): OAuthCredentialProfile["account"] {
  if (value !== undefined && !isRecord(value)) {
    throw new Error(`credentials.json profile ${profileId} account 无效`);
  }
  const account = isRecord(value) ? value : {};
  return {
    accountId: readNullableString(account.accountId, `profile ${profileId} account.accountId`),
    email: readNullableString(account.email, `profile ${profileId} account.email`),
  };
}

function readLastRefresh(profileId: string, value: unknown): OAuthCredentialProfile["lastRefresh"] {
  if (value !== undefined && !isRecord(value)) {
    throw new Error(`credentials.json profile ${profileId} lastRefresh 无效`);
  }
  const lastRefresh = isRecord(value) ? value : {};
  const status = lastRefresh.status ?? "never";
  if (!LAST_REFRESH_STATUSES.has(status as OAuthCredentialProfile["lastRefresh"]["status"])) {
    throw new Error(`credentials.json profile ${profileId} lastRefresh.status 无效`);
  }
  return {
    status: status as OAuthCredentialProfile["lastRefresh"]["status"],
    at: readNullableString(lastRefresh.at, `profile ${profileId} lastRefresh.at`),
    errorCode: readNullableString(lastRefresh.errorCode, `profile ${profileId} lastRefresh.errorCode`),
    message: readNullableString(lastRefresh.message, `profile ${profileId} lastRefresh.message`),
  };
}

function parseProfile(profileId: string, value: unknown): OAuthCredentialProfile {
  const profile = requireRecord(value, `profile ${profileId}`);
  if (profile.type !== "oauth") {
    throw new Error(`credentials.json profile ${profileId} type 无效`);
  }
  if (profile.provider !== "openai-codex") {
    throw new Error(`credentials.json profile ${profileId} provider 无效`);
  }
  const tokens = requireRecord(profile.tokens, `profile ${profileId} tokens`);
  return {
    type: "oauth",
    provider: "openai-codex",
    source: readSource(profileId, profile.source),
    account: readAccount(profileId, profile.account),
    tokens: {
      accessToken: requireString(tokens.accessToken, `profile ${profileId} tokens.accessToken`),
      refreshToken: requireString(tokens.refreshToken, `profile ${profileId} tokens.refreshToken`),
      expiresAt: requireString(tokens.expiresAt, `profile ${profileId} tokens.expiresAt`),
    },
    lastRefresh: readLastRefresh(profileId, profile.lastRefresh),
  };
}

export function createEmptyCredentialStore(): CredentialStore {
  return {
    version: 1,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: {},
  };
}

export function parseCredentialStore(value: unknown): CredentialStore {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("credentials.json 缺少 version: 1");
  }
  if (value.activeProfileId !== DEFAULT_PROFILE_ID) {
    throw new Error(`credentials.json activeProfileId 必须为 ${DEFAULT_PROFILE_ID}`);
  }
  const rawProfiles = requireRecord(value.profiles, "profiles");
  const profiles: Record<string, OAuthCredentialProfile> = {};
  for (const [profileId, profile] of Object.entries(rawProfiles)) {
    profiles[profileId] = parseProfile(profileId, profile);
  }
  return {
    version: 1,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles,
  };
}

export async function loadCredentialStore(paths: GatewayPaths): Promise<CredentialStore> {
  try {
    await assertSecretFilePermissions(paths.credentialsPath);
    return parseCredentialStore(await readJsonFile(paths.credentialsPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyCredentialStore();
    }
    throw error;
  }
}

export async function saveCredentialStore(paths: GatewayPaths, store: CredentialStore): Promise<void> {
  let normalized: CredentialStore;
  try {
    normalized = parseCredentialStore(store);
  } catch (error) {
    throw new Error(
      `saveCredentialStore: 内存中的 CredentialStore 不合法 (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
  await writeSecretJsonFile(paths.credentialsPath, normalized);
}

export function maskEmail(email: string | null): string | null {
  if (email === null) {
    return null;
  }
  const atIndex = email.indexOf("@");
  if (atIndex < 0) {
    return email ? `${email[0]}***` : "***";
  }
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  return `${local[0] ?? "*"}***@${domain}`;
}

export function summarizeCredentialStore(store: CredentialStore): CredentialStatusSummary {
  const profile = store.profiles[store.activeProfileId];
  if (!profile) {
    return {
      loggedIn: false,
      profileId: null,
      provider: null,
      sourceMode: null,
      accountId: null,
      email: null,
      expiresAt: null,
      lastRefresh: null,
    };
  }
  return {
    loggedIn: true,
    profileId: store.activeProfileId,
    provider: profile.provider,
    sourceMode: profile.source.mode,
    accountId: profile.account.accountId,
    email: maskEmail(profile.account.email),
    expiresAt: profile.tokens.expiresAt,
    lastRefresh: {
      status: profile.lastRefresh.status,
      at: profile.lastRefresh.at,
      errorCode: profile.lastRefresh.errorCode,
      message: null,
    },
  };
}
