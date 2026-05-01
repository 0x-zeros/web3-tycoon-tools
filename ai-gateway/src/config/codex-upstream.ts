/**
 * Codex 上游派生常量 - 单一信源
 *
 * 上游参考：CLIProxyAPI (MIT License)
 *   https://github.com/router-for-me/CLIProxyAPI
 *
 * 上次同步：CLIProxyAPI commit 8b286e8f @ 2026-04-30
 * 同步流程：见 docs/UPSTREAM-SYNC.md
 *
 * 修改原则：本文件里的每条常量都派生自 OpenAI Codex / ChatGPT 上游的实际行为约束。
 * 不要凭直觉改。改任何一行前：
 *   1. 看 CLIProxyAPI 在 internal/runtime/executor/codex_executor.go 里这条还在不在
 *   2. 看 internal/auth/codex/openai_auth.go 里 OAuth 这块还在不在
 *   3. 跑 ai-gateway-smoke 真实环境验证
 *   4. 在 docs/UPSTREAM-SYNC.md 加同步条目
 */

/* ---------- HTTP 端点 ---------- */

/**
 * Codex /responses 上游 base URL。
 * 来源：CLIProxyAPI internal/runtime/executor/codex_executor.go:154
 */
export const OPENAI_CODEX_RESPONSES_BASE_URL = "https://chatgpt.com/backend-api/codex";

/* ---------- OAuth 端点与客户端 ---------- */

/**
 * 来源：CLIProxyAPI internal/auth/codex/openai_auth.go:24-28
 */
export const OPENAI_AUTH_BASE_URL = "https://auth.openai.com";
export const OPENAI_CODEX_AUTHORIZE_PATH = "/oauth/authorize";
export const OPENAI_CODEX_TOKEN_PATH = "/oauth/token";
export const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/**
 * redirect_uri 必须用字面量 "localhost"（不是 127.0.0.1），
 * 否则 OpenAI auth 服务器返回 unknown_error。
 * 来源：CLIProxyAPI internal/auth/codex/openai_auth.go:27
 */
export const OPENAI_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";

/**
 * OAuth scope。注意顺序：openid email profile offline_access。
 * 来源：CLIProxyAPI internal/auth/codex/openai_auth.go:72
 */
export const OPENAI_CODEX_SCOPE = "openid email profile offline_access";

/**
 * authorize URL 上必须附带的额外 query 参数。
 * 缺这三个会让 OpenAI auth 返回 unknown_error。
 * 来源：CLIProxyAPI internal/auth/codex/openai_auth.go:76-78
 */
export const OPENAI_CODEX_AUTHORIZE_EXTRA_PARAMS = {
  prompt: "login",
  id_token_add_organizations: "true",
  codex_cli_simplified_flow: "true",
} as const;

/* ---------- OAuth Device Code Flow ---------- */

/**
 * Device code 模式不依赖本机 callback server，适合 headless server / SSH /
 * devcontainer 端口转发不通的场景。流程：
 *   1) POST usercode → 拿 device_auth_id + user_code（短码）
 *   2) 用户在任意带浏览器设备打开 verificationUrl，输入 user_code 完成授权
 *   3) CLI 轮询 token 端点直到拿 authorization_code + 服务器生成的 PKCE 配对
 *   4) 用既有 /oauth/token exchange 换 access/refresh token，
 *      但 redirect_uri 必须用 deviceauth/callback 字面量（不是 localhost）
 * 来源：CLIProxyAPI sdk/auth/codex_device.go:27-33
 */
export const OPENAI_CODEX_DEVICE_USERCODE_PATH = "/api/accounts/deviceauth/usercode";
export const OPENAI_CODEX_DEVICE_TOKEN_PATH = "/api/accounts/deviceauth/token";

/**
 * 用户输入 user_code 的浏览器页面（可在任意联网设备打开，不必是 CLI 同机）。
 * 来源：CLIProxyAPI sdk/auth/codex_device.go:29
 */
export const OPENAI_CODEX_DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";

/**
 * Device flow 第二阶段（authorization_code → token）的 redirect_uri 字面量。
 * 服务器并不会真的把浏览器重定向到这里，纯粹用来绑定 OAuth code 与 PKCE 校验。
 * 必须与上游硬编码完全一致，否则 token exchange 失败。
 * 来源：CLIProxyAPI sdk/auth/codex_device.go:30
 */
export const OPENAI_CODEX_DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";

/**
 * 轮询默认间隔（秒）和总超时（毫秒）。usercode 响应的 interval 字段优先。
 * 来源：CLIProxyAPI sdk/auth/codex_device.go:31-33
 */
export const OPENAI_CODEX_DEVICE_DEFAULT_POLL_INTERVAL_S = 5;
export const OPENAI_CODEX_DEVICE_TIMEOUT_MS = 15 * 60_000;

/* ---------- /responses 请求 headers ---------- */

/**
 * User-Agent 必须保持 "Mac OS" 字样，否则 CLIProxyAPI 不会写 Session_id 头，
 * 上游也可能因此分流到不同的处理路径。这是 Codex TUI 客户端的对外身份。
 * 来源：CLIProxyAPI internal/runtime/executor/codex_executor.go:33
 */
export const CODEX_USER_AGENT =
  "codex-tui/0.118.0 (Mac OS 26.3.1; arm64) iTerm.app/3.6.9 (codex-tui; 0.118.0)";

/**
 * Originator 头：声明本次请求是哪个 Codex 客户端发起的。
 * 注意：不是 "codex_cli_rs"（那是 Rust 二进制内部 base name），对外是 "codex-tui"。
 * 来源：CLIProxyAPI internal/runtime/executor/codex_executor.go:34
 */
export const CODEX_ORIGINATOR = "codex-tui";

/**
 * 流式响应的 Accept 头值。Codex /responses 总是返回 SSE，
 * 客户端需要明确声明接受 text/event-stream。
 */
export const CODEX_ACCEPT_STREAM = "text/event-stream";

/**
 * 非流式（聚合）请求的 Accept 头值。CLIProxyAPI 在 executeCompact 路径用这个，
 * 但常规 /responses 路径无论客户端 stream 字段如何，上游都按 SSE 响应。
 * 我们的网关：上游永远 stream=true，按客户端意愿决定是否聚合后再下发。
 */
export const CODEX_ACCEPT_JSON = "application/json";

/**
 * 长连接复用，配合 SSE 流。
 */
export const CODEX_CONNECTION = "Keep-Alive";

/* ---------- /responses body 规范化 ---------- */

/**
 * 这些字段如果客户端发上来，转给上游前必须删掉，否则上游 400。
 * 来源（合并以下两处）：
 *   - CLIProxyAPI internal/runtime/executor/codex_executor.go:180-183
 *   - CLIProxyAPI internal/translator/codex/openai/responses/codex_openai-responses_request.go:25-39
 */
export const CODEX_BODY_FIELDS_TO_DELETE = [
  "previous_response_id",
  "prompt_cache_retention",
  "safety_identifier",
  "stream_options",
  "max_output_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "truncation",
  "context_management",
  "user",
] as const;

/**
 * Codex /responses 强制要求 body 含 instructions 字段。
 * 缺失或 null 时上游返回 400 "Instructions are required"。
 * 网关侧兜底：客户端没发就塞个空串。
 * 来源：CLIProxyAPI internal/runtime/executor/codex_executor.go:878-884
 */
export const CODEX_INSTRUCTIONS_FALLBACK = "";

/**
 * Codex /responses 强制注入的 body 字段。客户端发的同名值会被覆盖。
 * 来源：CLIProxyAPI internal/translator/codex/openai/responses/codex_openai-responses_request.go:20-23
 */
export const CODEX_FORCED_BODY_FIELDS = {
  stream: true,
  store: false,
  parallel_tool_calls: true,
  include: ["reasoning.encrypted_content"],
} as const;

/**
 * 内置 tool 类型的兼容别名映射。客户端发的旧名字（web_search_preview 等）
 * 会被改写成上游接受的稳定名字（web_search）。
 * 来源：CLIProxyAPI internal/translator/codex/openai/responses/codex_openai-responses_request.go:135-141
 */
export const CODEX_BUILTIN_TOOL_ALIASES: Readonly<Record<string, string>> = {
  web_search_preview: "web_search",
  web_search_preview_2025_03_11: "web_search",
};

/**
 * service_tier 字段：只保留 "priority"，其他值（含 "auto"、"default"）一律删除。
 * 来源：CLIProxyAPI internal/translator/codex/openai/responses/codex_openai-responses_request.go:29-33
 */
export const CODEX_SERVICE_TIER_KEEP = "priority";

/**
 * input 是字符串时，需要转换成 OpenAI Responses API 的 message 格式。
 * 来源：CLIProxyAPI internal/translator/codex/openai/responses/codex_openai-responses_request.go:14-18
 */
export const CODEX_USER_INPUT_TEMPLATE_TYPE = "message";
export const CODEX_USER_INPUT_TEMPLATE_ROLE = "user";
export const CODEX_USER_INPUT_TEMPLATE_PART_TYPE = "input_text";

/**
 * Codex 不接受 input array 中 role: "system"，必须改写为 "developer"。
 * 来源：CLIProxyAPI internal/translator/codex/openai/responses/codex_openai-responses_request.go:68-86
 */
export const CODEX_INPUT_ROLE_REWRITE: Readonly<Record<string, string>> = {
  system: "developer",
};

/* ---------- 流式策略 ---------- */

/**
 * Codex /responses 上游永远以 SSE 形式响应。我们的网关策略：
 *   - 客户端 stream=true：透传 SSE 流（Accept: text/event-stream）
 *   - 客户端 stream=false：上游照样请求 stream=true，网关侧聚合 SSE → 返回 response.completed 的 JSON
 * 这跟 CLIProxyAPI Execute()/ExecuteStream() 双路径一致。
 * 来源：CLIProxyAPI internal/runtime/executor/codex_executor.go:179, 238-298
 */
export const CODEX_UPSTREAM_ALWAYS_STREAM = true;
