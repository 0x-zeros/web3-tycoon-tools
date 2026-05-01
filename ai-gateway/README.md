# AI Gateway

本项目是个人使用的本地 / 私有 AI 网关，把 Codex / ChatGPT subscription OAuth
凭据集中在一个本地服务中处理，并把 OpenAI Responses API 兼容请求转发到
ChatGPT Codex 后端。

## 它能做什么

- 接受标准 OpenAI Responses API 请求（`POST /v1/responses`），转发到
  `https://chatgpt.com/backend-api/codex/responses`
- 自动维护 OAuth access token：进入 5 分钟刷新窗口时单飞刷新
- 自动适配 Codex 上游约束：注入必备 headers / 删 Codex 不接受的字段 /
  字符串 input 转 message 数组 / 流式 SSE 与非流式 JSON 双模出口
- 不在日志、错误、状态页里输出完整 token

## 它不做什么（第一版边界）

- 不实现多用户、多租户、计费、后台管理、账号池
- 不使用系统 keychain 作为凭据存储（只用本地 `credentials.json`，0600）
- 不引入 Express / SQLite / Redis / Docker / TLS
- 不做 OpenAI ↔ Anthropic ↔ Gemini 协议互译

## 快速上手

```bash
pnpm install
pnpm dev -- auth import-codex-cli --takeover   # 导入已登录的 Codex CLI 凭据
pnpm dev -- auth status                         # 验证状态
pnpm dev -- serve                               # 启动网关
```

另开终端：

```bash
curl -s http://127.0.0.1:8787/v1/responses \
  -H 'content-type: application/json' \
  -d '{"model":"codex-default","input":"用一句话回答：AI Gateway 已启动了吗？"}'
```

## CLI 命令参考

所有命令都通过 `pnpm dev -- <command>` 运行（`--` 是 pnpm 透传分隔符；
`pnpm dev <command>` 也兼容）。

### `auth login`

完整登录流程，把 access / refresh token 写入 `~/.ai-gateway/credentials.json`。

进入命令后会先 prompt 让你在两种登录方式中选：

#### 1) 浏览器自动回调（loopback）

- **优点**：浏览器登录完成后凭据自动写入，无需手动复制 URL/code
- **适用**：本机有图形浏览器、且能访问 `http://localhost:1455`
  （devcontainer 里 forwardPorts 起作用时也能用）

行为：
1. 生成 PKCE code_verifier / code_challenge 与 state
2. 拼出 authorize URL（含 `prompt=login` / `id_token_add_organizations=true`
   / `codex_cli_simplified_flow=true` 等 Codex 必备 query 参数），打印到终端
3. 在本地 IPv4 `127.0.0.1:1455` + IPv6 `[::1]:1455` 双栈起一次性 callback server
4. 浏览器回调失败时（端口被占 / 端口转发不通）回退到手工粘贴 redirect URL 或
   authorization code
5. 拿到 code 后用 PKCE verifier 交换 access / refresh token

#### 2) Device code（设备码）

- **优点**：不需要本机 callback server / 端口转发，浏览器和 CLI 可以在不同
  设备 / 不同网络（手机扫码也行），过 NAT / 防火墙不影响
- **适用**：headless server / SSH 远程 / devcontainer 端口转发不通的环境

行为：
1. POST `https://auth.openai.com/api/accounts/deviceauth/usercode` 拿
   `device_auth_id` + `user_code`
2. 在终端醒目地展示 verification URL（`https://auth.openai.com/codex/device`）
   和 `user_code`
3. 用户在任意联网设备打开 URL，输入 user_code 完成授权
4. CLI 按服务器指定的 interval（默认 5s）轮询
   `POST /api/accounts/deviceauth/token`，最长 15 分钟
5. 拿到 `authorization_code` + 服务器生成的 PKCE 配对后，用既有 token exchange
   流程换 access / refresh token（`redirect_uri` 用上游硬编码字面量
   `https://auth.openai.com/deviceauth/callback`，服务器并不会真的重定向）

两种方式登录成功都写入 credentials.json 权限 0600，`source.mode = "gateway-oauth"`，
最后会打印一份 `auth status` 摘要供立即确认。

### `auth import-codex-cli --takeover`

不走 OAuth，直接读 Codex CLI 已登录的 `~/.codex/auth.json`（受
`CODEX_HOME` 环境变量影响），把它的 access / refresh / account_id
搬进 ai-gateway 自己的 `credentials.json`。

`--takeover` 是必传 flag，含义是：你**明确知道**接管之后 ai-gateway 会
独立刷新这把 refresh token，跟原 Codex CLI 的刷新会互相争抢。

成功后 `source.mode = "codex-cli-imported"`。

### `auth status`

打印当前凭据的 JSON 摘要，**不输出**完整 token：

```json
{
  "loggedIn": true,
  "profileId": "openai-codex:default",
  "provider": "openai-codex",
  "sourceMode": "codex-cli-imported",   // 或 "gateway-oauth"
  "accountId": "f768ac57-...",
  "email": "u***@example.com",
  "expiresAt": "2026-05-05T03:47:11.000Z",
  "lastRefresh": { "status": "...", "at": "...", "errorCode": null, "message": null }
}
```

### `serve [--host <h>] [--port <p>]`

启动 HTTP 网关。默认 `127.0.0.1:8787`。

行为：
1. 加载 `~/.ai-gateway/config.json`（首次会创建默认值）
2. 校验绑定安全：监听非 `127.0.0.1` 时必须设置 `AI_GATEWAY_API_TOKEN`，否则拒启
3. 起 `CodexProvider` + `CredentialManager` + `RequestLogger`
4. 监听 HTTP，按下面 [HTTP API](#http-api) 提供端点

`--host`、`--port` 覆盖 config.json 里的默认值。

## HTTP API

### `GET /health`

返回 `{ ok: true }`，用于存活探针。鉴权关闭时随便访问；开了 `AI_GATEWAY_API_TOKEN`
时也要带 Bearer。

### `GET /`

HTML 状态页，给浏览器看。

### `GET /status`

返回当前网关状态：

```json
{
  "auth": {
    "loggedIn": true,
    "sourceMode": "codex-cli-imported",
    "email": "u***@example.com",
    "expiresAt": "..."
  },
  "models": ["codex-default"],
  "defaultModelAlias": "codex-default",
  "provider": {
    "activeRequests": 0,
    "cooldownUntil": null,        // 上游 429 冷却结束时间（ISO）
    "maxConcurrency": 4
  }
}
```

绝不会出现完整 token。

### `POST /v1/responses`

OpenAI Responses API 兼容端点。客户端发什么字段都可以（不再做白名单），
网关侧自动做以下规范化（参考 CLIProxyAPI translator）：

- 字符串 `input` → message 数组
- 删除 Codex 不接受的 11 个字段（`temperature` / `top_p` /
  `max_output_tokens` / `previous_response_id` / `truncation` /
  `context_management` 等）
- `instructions` 缺失或 null 时兜底为空串
- 强制注入 `stream: true` / `store: false` / `parallel_tool_calls: true`
  / `include: ["reasoning.encrypted_content"]`
- `input` 数组中 `role: "system"` → `"developer"`
- 旧名 `web_search_preview` → `web_search`

返回模式由客户端 `stream` 字段决定：

| 客户端发 `stream` | 上游 body | 网关响应 |
| --- | --- | --- |
| `true` | `stream: true`（强制） | 透传 SSE，逐 chunk 下发 |
| `false` 或缺省 | `stream: true`（强制） | 网关消费完 SSE，返回 `response.completed.response` 字段（`Content-Type: application/json`）|

错误码：

| HTTP | error.code | 含义 |
| --- | --- | --- |
| 400 | `invalid_json` | 请求体不是合法 JSON |
| 400 | `unknown_model_alias` | 客户端 `model` 字段不在 `~/.ai-gateway/config.json` 的 alias 列表 |
| 401 | `unauthorized` | 设置了 `AI_GATEWAY_API_TOKEN` 但客户端没带或值不对 |
| 413 | `request_too_large` | 请求体超过 1 MB |
| 429 | `upstream_cooldown` | 上游最近返回过 429，本地 cooldown 窗口未过 |
| 503 | `auth_unavailable` | 凭据缺失 / 刷新失败 |
| 502 | `upstream_error` | 其他上游 / 网关错误 |
| 502+ | 透传上游 | 上游 4xx/5xx 时把 status 与 body 原样转发 |

## 配置文件

### `~/.ai-gateway/credentials.json`

OAuth 凭据 sink，权限 0600。结构：

```json
{
  "version": 1,
  "activeProfileId": "openai-codex:default",
  "profiles": {
    "openai-codex:default": {
      "type": "oauth",
      "provider": "openai-codex",
      "source": { "mode": "...", "importedFrom": null, "importedAt": null },
      "account": { "accountId": "...", "email": null },
      "tokens": { "accessToken": "...", "refreshToken": "...", "expiresAt": "..." },
      "lastRefresh": { "status": "...", "at": "...", "errorCode": null, "message": null }
    }
  }
}
```

### `~/.ai-gateway/config.json`

服务配置，首次 `serve` 时会创建默认值。可手动改：

```json
{
  "version": 1,
  "defaultModelAlias": "codex-default",
  "models": {
    "codex-default": { "provider": "openai-codex", "upstreamModel": "gpt-5.3-codex" }
  },
  "server": {
    "host": "127.0.0.1",
    "port": 8787,
    "maxConcurrency": 4,
    "cooldownMs": 30000
  }
}
```

## 环境变量

| 名称 | 用途 | 默认 |
| --- | --- | --- |
| `AI_GATEWAY_HOME` | 覆盖凭据 / 配置 / 日志根目录 | `~/.ai-gateway` |
| `AI_GATEWAY_API_TOKEN` | 启用 HTTP Bearer 鉴权（绑定非本机时必填） | (空，关闭鉴权) |
| `AI_GATEWAY_DEBUG_CAPTURE` | 设为 `1` 时把请求 / 响应正文写入 `debug-capture.jsonl`（仍脱敏 token） | (空，关闭) |
| `CODEX_HOME` | `auth import-codex-cli` 读取的 Codex CLI 主目录 | `~/.codex` |

## 安全边界

- 默认监听 `127.0.0.1`，拒绝直接对外
- `--host` 改为非本地地址时必须配 `AI_GATEWAY_API_TOKEN`，否则启动失败
- 默认日志只保存请求摘要（model alias、status code、耗时、错误码）
- `AI_GATEWAY_DEBUG_CAPTURE=1` 时才写完整请求 / 响应到 `debug-capture.jsonl`，
  并自动脱敏 `Authorization` / `access_token` / `refresh_token` / `id_token`
- 启动时检查 `credentials.json` 文件权限，非 0600 拒绝运行

## 上游同步与升级

ai-gateway 的 Codex 行为派生自 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（MIT）。

- 单一信源：`src/config/codex-upstream.ts`（每个常量带 `来源：CLIProxyAPI <文件:行号>` 注释）
- 同步台账：`docs/UPSTREAM-SYNC.md`（历次 sync 的 commit sha + take/skip 决策）
- 应急手册：`docs/UPGRADING.md`（smoke 失败 / 上游突变时怎么办）
- 主动检查：`./scripts/sync-check.sh`（diff 自上次同步以来上游关心文件的变化）

## 真实环境冒烟测试

`ai-gateway-smoke` 是独立子项目，通过 HTTP 调用本网关。
用法见它的 README。最小验收：

```bash
# 终端 1
pnpm dev -- serve

# 终端 2
cd ../ai-gateway-smoke
pnpm check:all
```

全 ✓ 即代表完整链路可用。
