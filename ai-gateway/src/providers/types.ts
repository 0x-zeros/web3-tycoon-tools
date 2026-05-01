export type RefreshTokenResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export type CodexRefreshFunction = (refreshToken: string) => Promise<RefreshTokenResult>;
