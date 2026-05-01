import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { GatewayConfig, ModelAliasConfig } from "./types.js";
import type { GatewayPaths } from "../util/home.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalInteger(
  value: unknown,
  fieldName: string,
  defaultValue: number,
  isValid: (value: number) => boolean,
): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || !isValid(value)) {
    throw new Error(`config.json ${fieldName} 无效`);
  }
  return value;
}

export function parseGatewayConfig(value: unknown): GatewayConfig {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("config.json 缺少 version: 1");
  }
  if (typeof value.defaultModelAlias !== "string" || !value.defaultModelAlias.trim()) {
    throw new Error("config.json 缺少 defaultModelAlias");
  }
  if (!isRecord(value.models)) {
    throw new Error("config.json 缺少 models");
  }
  const models: Record<string, ModelAliasConfig> = {};
  for (const [alias, model] of Object.entries(value.models)) {
    if (
      !isRecord(model) ||
      model.provider !== "openai-codex" ||
      typeof model.upstreamModel !== "string" ||
      !model.upstreamModel.trim()
    ) {
      throw new Error(`config.json 模型别名无效: ${alias}`);
    }
    models[alias] = { provider: "openai-codex", upstreamModel: model.upstreamModel };
  }
  if (!models[value.defaultModelAlias]) {
    throw new Error("config.json 默认模型别名未配置");
  }
  const server = isRecord(value.server) ? value.server : {};
  return {
    version: 1,
    defaultModelAlias: value.defaultModelAlias,
    models,
    server: {
      host: typeof server.host === "string" ? server.host : DEFAULT_CONFIG.server.host,
      port: readOptionalInteger(server.port, "server.port", DEFAULT_CONFIG.server.port, (port) => port >= 1 && port <= 65_535),
      maxConcurrency: readOptionalInteger(
        server.maxConcurrency,
        "server.maxConcurrency",
        DEFAULT_CONFIG.server.maxConcurrency,
        (maxConcurrency) => maxConcurrency >= 1,
      ),
      cooldownMs: readOptionalInteger(
        server.cooldownMs,
        "server.cooldownMs",
        DEFAULT_CONFIG.server.cooldownMs,
        (cooldownMs) => cooldownMs >= 0,
      ),
    },
  };
}

export async function loadOrCreateConfig(paths: GatewayPaths): Promise<GatewayConfig> {
  await mkdir(paths.homeDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.locksDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.logsDir, { recursive: true, mode: 0o700 });
  try {
    const raw = await readFile(paths.configPath, "utf8");
    try {
      return parseGatewayConfig(JSON.parse(raw));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("config.json 不是合法 JSON", { cause: error });
      }
      throw error;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    await writeFile(paths.configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { mode: 0o600 });
    return DEFAULT_CONFIG;
  }
}

export function resolveModelAlias(config: GatewayConfig, alias: string | undefined): ModelAliasConfig {
  const modelAlias = alias?.trim() || config.defaultModelAlias;
  const model = config.models[modelAlias];
  if (!model) {
    throw new Error(`unknown_model_alias: ${modelAlias}`);
  }
  return model;
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function validateServeSecurity(params: { host: string; apiToken: string | undefined }): void {
  if (!isLoopbackHost(params.host) && !params.apiToken?.trim()) {
    throw new Error("绑定非本机地址时必须设置 AI_GATEWAY_API_TOKEN");
  }
}
