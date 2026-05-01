export type ProviderId = "openai-codex";

export type ModelAliasConfig = {
  provider: ProviderId;
  upstreamModel: string;
};

export type GatewayConfig = {
  version: 1;
  defaultModelAlias: string;
  models: Record<string, ModelAliasConfig>;
  server: {
    host: string;
    port: number;
    maxConcurrency: number;
    cooldownMs: number;
  };
};
