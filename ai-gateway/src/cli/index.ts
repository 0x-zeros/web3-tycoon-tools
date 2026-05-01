#!/usr/bin/env node
import { loadOrCreateConfig, validateServeSecurity } from "../config/config-store.js";
import { OPENAI_CODEX_RESPONSES_BASE_URL } from "../config/defaults.js";
import type { GatewayPaths } from "../util/home.js";
import { resolveGatewayPaths } from "../util/home.js";
import {
  createEmptyCredentialStore,
  loadCredentialStore,
  saveCredentialStore,
  summarizeCredentialStore,
} from "../auth/credential-store.js";
import { DEFAULT_PROFILE_ID } from "../auth/types.js";
import { readCodexCliAuthJson, toImportedCodexProfile } from "../auth/codex-cli.js";
import { CredentialManager } from "../auth/credential-manager.js";
import { CodexProvider } from "../providers/codex.js";
import { RequestLogger } from "../logging/request-log.js";
import { createGatewayServer } from "../server/http.js";
import { promptLoginMode } from "./login-mode.js";
import { printError, printJson, printLine } from "./output.js";

export type CliCommand =
  | { command: "auth:status" }
  | { command: "auth:import-codex-cli"; takeover: boolean }
  | { command: "auth:login" }
  | { command: "serve"; host?: string; port?: number };

const USAGE = "未知命令。可用命令：auth status、auth login、auth import-codex-cli --takeover、serve";

export function parseCliArgs(rawArgs: string[]): CliCommand {
  // 兼容 `pnpm dev -- auth status`：旧版 pnpm 会把 `--` 透传给脚本作为第一个 argv。
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  if (args[0] === "auth" && args[1] === "status") {
    return { command: "auth:status" };
  }
  if (args[0] === "auth" && args[1] === "login") {
    return { command: "auth:login" };
  }
  if (args[0] === "auth" && args[1] === "import-codex-cli") {
    return { command: "auth:import-codex-cli", takeover: args.includes("--takeover") };
  }
  if (args[0] === "serve") {
    const hostIndex = args.indexOf("--host");
    const portIndex = args.indexOf("--port");
    return {
      command: "serve",
      host: hostIndex >= 0 ? args[hostIndex + 1] : undefined,
      port: portIndex >= 0 ? Number(args[portIndex + 1]) : undefined,
    };
  }
  throw new Error(USAGE);
}

async function withLineReader<T>(fn: (read: () => Promise<string>) => Promise<T>): Promise<T> {
  // readline 起一次：promptLoginMode 内部循环每次调 read = 读一行。
  // 用完即关，否则 stdin 在 flowing 模式 ref 着 event loop，进程退不出去。
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await fn(() => new Promise<string>((resolve) => rl.question("", resolve)));
  } finally {
    rl.close();
    process.stdin.unref();
  }
}

async function runLoopbackLogin(paths: GatewayPaths): Promise<void> {
  const { createPkcePair } = await import("../auth/pkce.js");
  const { buildAuthorizeUrl, completeOAuthLoginWithCode, parseCallbackUrl, waitForLocalCallback } =
    await import("../auth/oauth.js");
  const { OPENAI_CODEX_OAUTH_DEFAULTS } = await import("../config/defaults.js");
  const pkce = await createPkcePair();
  const authorizeUrl = buildAuthorizeUrl({
    ...OPENAI_CODEX_OAUTH_DEFAULTS,
    challenge: pkce.challenge,
    state: pkce.state,
  });
  printLine("请在浏览器中打开以下 URL 完成登录：");
  printLine(authorizeUrl.toString());
  const redirectUrl = new URL(OPENAI_CODEX_OAUTH_DEFAULTS.redirectUri);
  let code: string;
  try {
    const callback = await waitForLocalCallback({
      port: Number(redirectUrl.port) || 1455,
      path: redirectUrl.pathname,
      expectedState: pkce.state,
      timeoutMs: 30_000,
    });
    code = callback.code;
  } catch {
    printLine("本地回调未完成。请粘贴完整 redirect URL 或 authorization code，然后按回车：");
    const input = await new Promise<string>((resolve) => {
      process.stdin.once("data", (chunk) => resolve(String(chunk).trim()));
    });
    // process.stdin.once("data") 会自动把 stdin 切到 flowing 模式，listener 移除后
    // stdin 仍 ref 着 event loop，进程就退不出去。读到输入后立刻 pause。
    process.stdin.pause();
    code = input.startsWith("http") ? parseCallbackUrl(input, pkce.state).code : input;
  }
  await completeOAuthLoginWithCode({
    paths,
    tokenUrl: `${OPENAI_CODEX_OAUTH_DEFAULTS.authBaseUrl}${OPENAI_CODEX_OAUTH_DEFAULTS.tokenPath}`,
    clientId: OPENAI_CODEX_OAUTH_DEFAULTS.clientId,
    code,
    codeVerifier: pkce.verifier,
    redirectUri: OPENAI_CODEX_OAUTH_DEFAULTS.redirectUri,
  });
}

async function runDeviceLogin(paths: GatewayPaths): Promise<void> {
  const { requestDeviceUserCode, pollDeviceToken } = await import("../auth/codex-device.js");
  const { completeOAuthLoginWithCode } = await import("../auth/oauth.js");
  const { OPENAI_CODEX_OAUTH_DEVICE_DEFAULTS } = await import("../config/defaults.js");
  const cfg = OPENAI_CODEX_OAUTH_DEVICE_DEFAULTS;
  printLine("正在向 OpenAI 申请 device code ...");
  const userCode = await requestDeviceUserCode({
    baseUrl: cfg.authBaseUrl,
    usercodePath: cfg.usercodePath,
    clientId: cfg.clientId,
  });
  printLine("");
  printLine("打开下面这个 URL（任意联网设备都行，包括手机）：");
  printLine(`  ${cfg.verificationUrl}`);
  printLine("");
  printLine(`输入 user code：${userCode.userCode}`);
  printLine("");
  printLine(`等待你完成验证（最长 ${Math.round(cfg.timeoutMs / 60_000)} 分钟）...`);
  const token = await pollDeviceToken({
    baseUrl: cfg.authBaseUrl,
    pollPath: cfg.pollPath,
    deviceAuthId: userCode.deviceAuthId,
    userCode: userCode.userCode,
    intervalMs: userCode.intervalMs,
    timeoutMs: cfg.timeoutMs,
  });
  printLine("授权完成，正在交换 access/refresh token ...");
  // PKCE 由服务器返回（不是客户端自己生成的）；redirect_uri 必须用 deviceauth/callback 字面量。
  await completeOAuthLoginWithCode({
    paths,
    tokenUrl: `${cfg.authBaseUrl}${cfg.tokenExchangePath}`,
    clientId: cfg.clientId,
    code: token.authorizationCode,
    codeVerifier: token.codeVerifier,
    redirectUri: cfg.redirectUri,
  });
}

export async function run(command: CliCommand): Promise<void> {
  const paths = resolveGatewayPaths();
  if (command.command === "auth:status") {
    printJson(summarizeCredentialStore(await loadCredentialStore(paths)));
    return;
  }
  if (command.command === "auth:import-codex-cli") {
    if (!command.takeover) {
      throw new Error("导入 Codex CLI 凭据必须显式传入 --takeover");
    }
    const credential = await readCodexCliAuthJson();
    if (!credential) {
      throw new Error("未找到可导入的 Codex CLI OAuth 凭据");
    }
    const store = createEmptyCredentialStore();
    store.profiles[DEFAULT_PROFILE_ID] = toImportedCodexProfile(credential);
    await saveCredentialStore(paths, store);
    printLine("已导入 Codex CLI 凭据，后续 refresh token 由 AI Gateway 接管。");
    return;
  }
  if (command.command === "auth:login") {
    const mode = await withLineReader(async (read) =>
      promptLoginMode({ read, print: printLine }),
    );
    if (mode === "loopback") {
      await runLoopbackLogin(paths);
    } else {
      await runDeviceLogin(paths);
    }
    printLine("OAuth 登录完成，凭据已写入 AI Gateway token sink。当前状态：");
    // 给用户立刻可见的反馈：email / 过期时间 / source mode，避免用户怀疑要不要再 Ctrl+C。
    printJson(summarizeCredentialStore(await loadCredentialStore(paths)));
    return;
  }
  if (command.command === "serve") {
    const config = await loadOrCreateConfig(paths);
    const host = command.host ?? config.server.host;
    const port = command.port ?? config.server.port;
    validateServeSecurity({ host, apiToken: process.env.AI_GATEWAY_API_TOKEN });
    const provider = new CodexProvider({
      baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
      maxConcurrency: config.server.maxConcurrency,
      cooldownMs: config.server.cooldownMs,
    });
    const credentialManager = new CredentialManager({
      paths,
      refreshToken: (refreshToken) => provider.refreshToken(refreshToken),
    });
    const requestLogger = new RequestLogger({
      logsDir: paths.logsDir,
      debugCapture: process.env.AI_GATEWAY_DEBUG_CAPTURE === "1",
    });
    const server = createGatewayServer({
      config,
      apiToken: process.env.AI_GATEWAY_API_TOKEN,
      credentialManager,
      provider,
      credentialStatus: async () => summarizeCredentialStore(await loadCredentialStore(paths)),
      requestLogger,
    });
    await new Promise<void>((resolve) => server.listen(port, host, () => resolve()));
    printLine(`AI Gateway 正在监听 http://${host}:${port}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(parseCliArgs(process.argv.slice(2))).catch((error) => {
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
