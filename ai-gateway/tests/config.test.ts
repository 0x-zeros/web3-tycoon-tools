import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolveGatewayPaths } from "../src/util/home.js";
import {
  loadOrCreateConfig,
  parseGatewayConfig,
  resolveModelAlias,
  validateServeSecurity,
} from "../src/config/config-store.js";
import {
  DEFAULT_CONFIG,
  OPENAI_CODEX_OAUTH_DEFAULTS,
  OPENAI_CODEX_RESPONSES_BASE_URL,
} from "../src/config/defaults.js";

async function tempHome(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "ai-gateway-config-"));
}

test("AI_GATEWAY_HOME 覆盖默认状态目录", () => {
  const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: "/tmp/custom-ai-gateway" });
  assert.equal(paths.homeDir, "/tmp/custom-ai-gateway");
  assert.equal(paths.configPath, "/tmp/custom-ai-gateway/config.json");
  assert.equal(paths.credentialsPath, "/tmp/custom-ai-gateway/credentials.json");
  assert.equal(paths.locksDir, "/tmp/custom-ai-gateway/locks");
  assert.equal(paths.logsDir, "/tmp/custom-ai-gateway/logs");
});

test("未设置 AI_GATEWAY_HOME 时使用用户主目录下的默认状态目录", () => {
  const homeDir = path.join(os.homedir(), ".ai-gateway");
  const paths = resolveGatewayPaths({});
  assert.equal(paths.homeDir, homeDir);
  assert.equal(paths.configPath, path.join(homeDir, "config.json"));
  assert.equal(paths.credentialsPath, path.join(homeDir, "credentials.json"));
  assert.equal(paths.locksDir, path.join(homeDir, "locks"));
  assert.equal(paths.logsDir, path.join(homeDir, "logs"));
});

test("首次加载配置会创建默认模型别名和状态目录", async () => {
  const home = await tempHome();
  await rm(home, { recursive: true, force: true });
  try {
    const config = await loadOrCreateConfig(resolveGatewayPaths({ AI_GATEWAY_HOME: home }));
    assert.equal(config.defaultModelAlias, "codex-default");
    assert.equal(config.models["codex-default"].provider, "openai-codex");
    assert.equal(typeof config.models["codex-default"].upstreamModel, "string");
    const raw = await readFile(path.join(home, "config.json"), "utf8");
    assert.match(raw, /codex-default/);
    assert.equal((await stat(home)).isDirectory(), true);
    assert.equal((await stat(path.join(home, "locks"))).isDirectory(), true);
    assert.equal((await stat(path.join(home, "logs"))).isDirectory(), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("能读取并解析已有合法 config.json", async () => {
  const home = await tempHome();
  try {
    const rawConfig = {
      version: 1,
      defaultModelAlias: "custom-default",
      models: {
        "custom-default": {
          provider: "openai-codex",
          upstreamModel: "custom-upstream",
        },
      },
      server: {
        host: "localhost",
        port: 9797,
        maxConcurrency: 2,
        cooldownMs: 1234,
      },
    };
    await writeFile(path.join(home, "config.json"), `${JSON.stringify(rawConfig, null, 2)}\n`, "utf8");

    const config = await loadOrCreateConfig(resolveGatewayPaths({ AI_GATEWAY_HOME: home }));

    assert.equal(config.defaultModelAlias, "custom-default");
    assert.deepEqual(config.models["custom-default"], {
      provider: "openai-codex",
      upstreamModel: "custom-upstream",
    });
    assert.deepEqual(config.server, {
      host: "localhost",
      port: 9797,
      maxConcurrency: 2,
      cooldownMs: 1234,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("配置缺失 server 数值字段时使用默认值", () => {
  const config = parseGatewayConfig({
    version: 1,
    defaultModelAlias: "custom-default",
    models: {
      "custom-default": {
        provider: "openai-codex",
        upstreamModel: "custom-upstream",
      },
    },
    server: {
      host: "localhost",
    },
  });

  assert.deepEqual(config.server, {
    host: "localhost",
    port: DEFAULT_CONFIG.server.port,
    maxConcurrency: DEFAULT_CONFIG.server.maxConcurrency,
    cooldownMs: DEFAULT_CONFIG.server.cooldownMs,
  });
});

test("配置拒绝非法 server 数值字段", () => {
  const baseConfig = {
    version: 1,
    defaultModelAlias: "custom-default",
    models: {
      "custom-default": {
        provider: "openai-codex",
        upstreamModel: "custom-upstream",
      },
    },
  };

  for (const port of [0, 65_536, 1.5, Number.NaN]) {
    assert.throws(() => parseGatewayConfig({ ...baseConfig, server: { port } }), /server\.port/);
  }
  for (const maxConcurrency of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => parseGatewayConfig({ ...baseConfig, server: { maxConcurrency } }), /server\.maxConcurrency/);
  }
  for (const cooldownMs of [-1, 1.5, Number.NaN]) {
    assert.throws(() => parseGatewayConfig({ ...baseConfig, server: { cooldownMs } }), /server\.cooldownMs/);
  }
});

test("模型别名拒绝空白 upstreamModel", () => {
  assert.throws(
    () =>
      parseGatewayConfig({
        version: 1,
        defaultModelAlias: "custom-default",
        models: {
          "custom-default": {
            provider: "openai-codex",
            upstreamModel: "   ",
          },
        },
      }),
    /模型别名无效: custom-default/,
  );
});

test("未知模型别名会被拒绝", async () => {
  const home = await tempHome();
  try {
    const config = await loadOrCreateConfig(resolveGatewayPaths({ AI_GATEWAY_HOME: home }));
    assert.equal(resolveModelAlias(config, "codex-default").upstreamModel, config.models["codex-default"].upstreamModel);
    assert.throws(() => resolveModelAlias(config, "missing"), /unknown_model_alias/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("非 loopback 监听必须配置 API token", () => {
  assert.doesNotThrow(() => validateServeSecurity({ host: "127.0.0.1", apiToken: undefined }));
  assert.throws(() => validateServeSecurity({ host: "0.0.0.0", apiToken: undefined }), /AI_GATEWAY_API_TOKEN/);
  assert.doesNotThrow(() => validateServeSecurity({ host: "0.0.0.0", apiToken: "secret" }));
});

test("损坏的 config.json 会返回明确错误", async () => {
  const home = await tempHome();
  try {
    await writeFile(path.join(home, "config.json"), "{bad json", "utf8");
    await assert.rejects(
      () => loadOrCreateConfig(resolveGatewayPaths({ AI_GATEWAY_HOME: home })),
      /config.json 不是合法 JSON/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("默认配置包含预期 server 默认值", () => {
  assert.deepEqual(DEFAULT_CONFIG.server, {
    host: "127.0.0.1",
    port: 8787,
    maxConcurrency: 4,
    cooldownMs: 30_000,
  });
});

test("Codex OAuth 默认配置包含关键常量", () => {
  assert.equal(OPENAI_CODEX_OAUTH_DEFAULTS.authBaseUrl, "https://auth.openai.com");
  assert.equal(OPENAI_CODEX_OAUTH_DEFAULTS.authorizePath, "/oauth/authorize");
  assert.equal(OPENAI_CODEX_OAUTH_DEFAULTS.tokenPath, "/oauth/token");
  assert.equal(OPENAI_CODEX_OAUTH_DEFAULTS.clientId, "app_EMoamEEZ73f0CkXaXp7hrann");
  // redirectUri 必须用字面量 localhost，不是 127.0.0.1，否则 OpenAI auth 服务器返回 unknown_error
  assert.equal(OPENAI_CODEX_OAUTH_DEFAULTS.redirectUri, "http://localhost:1455/auth/callback");
  assert.match(OPENAI_CODEX_OAUTH_DEFAULTS.scope, /\bopenid\b/);
  assert.match(OPENAI_CODEX_OAUTH_DEFAULTS.scope, /\boffline_access\b/);
});

test("Codex OAuth 默认配置包含 authorize 必备的额外 query 参数", () => {
  // 缺这三个 OpenAI auth 返回 unknown_error
  assert.equal(OPENAI_CODEX_OAUTH_DEFAULTS.extraParams.prompt, "login");
  assert.equal(OPENAI_CODEX_OAUTH_DEFAULTS.extraParams.id_token_add_organizations, "true");
  assert.equal(OPENAI_CODEX_OAUTH_DEFAULTS.extraParams.codex_cli_simplified_flow, "true");
});

test("Codex Responses 默认地址指向 ChatGPT Codex 后端", () => {
  assert.equal(OPENAI_CODEX_RESPONSES_BASE_URL, "https://chatgpt.com/backend-api/codex");
});
