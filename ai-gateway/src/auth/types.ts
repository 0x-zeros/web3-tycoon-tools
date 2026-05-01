import type { ProviderId } from "../config/types.js";

export const DEFAULT_PROFILE_ID = "openai-codex:default";

export type CredentialSourceMode = "gateway-oauth" | "codex-cli-imported" | "codex-cli-readonly";

export type OAuthCredentialProfile = {
  type: "oauth";
  provider: ProviderId;
  source: { mode: CredentialSourceMode; importedFrom: string | null; importedAt: string | null };
  account: { accountId: string | null; email: string | null };
  tokens: { accessToken: string; refreshToken: string; expiresAt: string };
  lastRefresh: {
    status: "never" | "success" | "degraded" | "failed";
    at: string | null;
    errorCode: string | null;
    message: string | null;
  };
};

export type CredentialStore = {
  version: 1;
  activeProfileId: typeof DEFAULT_PROFILE_ID;
  profiles: Record<string, OAuthCredentialProfile>;
};

export type CredentialStatusSummary = {
  loggedIn: boolean;
  profileId: string | null;
  provider: ProviderId | null;
  sourceMode: CredentialSourceMode | null;
  accountId: string | null;
  email: string | null;
  expiresAt: string | null;
  lastRefresh: OAuthCredentialProfile["lastRefresh"] | null;
};
