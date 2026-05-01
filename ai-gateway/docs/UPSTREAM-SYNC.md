# 上游同步台账

ai-gateway 的 Codex 行为派生自 CLIProxyAPI（MIT License）。
本档记录每次同步上游行为变化的历史与流程。

## 上游来源

- **CLIProxyAPI**: <https://github.com/router-for-me/CLIProxyAPI>
- **本地缓存**: 由 `./scripts/sync-check.sh` 自动 clone / fetch 到 `.cache/CLIProxyAPI`（可用环境变量 `UPSTREAM_DIR` 覆盖）
- **License**: MIT (允许直接拷贝代码片段，需保留 attribution)

## 关心的上游文件

仅以下几个文件的变化会影响我们：

| 上游路径 | 影响什么 |
| --- | --- |
| `internal/auth/codex/openai_auth.go` | OAuth flow 端点、client_id、redirect_uri、authorize 参数 |
| `internal/runtime/executor/codex_executor.go` | header 列表、body 规范化、SSE 聚合策略 |
| `internal/auth/codex/jwt_parser.go` | 从 access_token JWT 解 accountId 的字段路径 |
| `internal/auth/codex/token.go` | token 数据结构（次要） |
| `sdk/auth/codex_device.go` | Device code flow 端点、轮询协议、二阶段 token exchange redirect_uri |

我们的所有上游派生常量集中在 `src/config/codex-upstream.ts`，
每条都带 `来源：CLIProxyAPI <文件>:<行号>` 注释。

## 同步动作（每次 sync 都做）

```bash
# 1. 看自上次同步以来关心文件改了什么（脚本会自动 clone / fetch 上游缓存）
cd /workspace/ai-gateway && ./scripts/sync-check.sh

# 2. 对每条 commit 决定 take / skip / partial
#    - 改了 OAuth params → 同步到 src/config/codex-upstream.ts
#    - 改了 header 列表 → 同上
#    - 改了 body normalize → 同上
#    - 重构 / 文档 / 不影响我们的 → skip

# 3. 跑回归
cd /workspace/ai-gateway
pnpm test && pnpm typecheck && pnpm build

# 4. 跑真实环境冒烟测试
#    终端 1: pnpm dev -- serve
#    终端 2: cd ../ai-gateway-smoke && pnpm check:all

# 5. 在本档"同步记录"加一条 entry（最新在最上）

# 6. commit, message 引用上游 commit sha
git commit -m "同步 Codex 上游：<简述变化>

来源：CLIProxyAPI commit <sha>"
```

## 故意不同步的部分

CLIProxyAPI 是多 provider / 多账号 / 含管理面板的全功能代理，我们第一版边界刻意更窄。
以下能力**不会**同步进我们 repo（除非 plan 边界改）：

- **多账号 rotation**（CLIProxyAPI auth-dir 多文件 + 选择器）—— 我们单 profile
- **API 协议互译**（OpenAI ↔ Claude ↔ Gemini 格式 translator）—— 我们只做 OpenAI Responses 透传
- **prompt cache key 复用**（基于 user_id / api_key 派生 cache id）—— 我们第一版不做
- **image_generation tool 注入**（`ensureImageGenerationTool`）—— 客户端自己发就好
- **thinking provider** 包装（reasoning effort 适配层）—— 客户端自己发
- **管理面板下载** —— 我们没面板
- **Redis 队列 / pprof / TLS 服务器** —— 单进程没必要
- **WebSocket executor** —— SSE 已够用

如果某次同步发现上游在这些"不做"区域有重要安全/正确性 fix，会单独评估。

## 故障兜底：runtime canary

每次跑 `pnpm check:all`（ai-gateway-smoke）都是真实环境探针。
即使我们 6 周才主动同步一次，OpenAI 突变也会被 smoke 测试当场 catch。
出现非预期 4xx / 5xx / 字段缺失，先看 `docs/UPGRADING.md` 流程。

---

## 同步记录（最新在最上）

### 2026-05-01 - 补漏 Codex Device Code Flow

- **CLIProxyAPI commit**: `8b286e8fb39e1cc95dd86d8923e8baa83dec8722`（同上次同步，
  device flow 在那个 commit 已经存在，初次同步时漏看 `sdk/auth/codex_device.go`）
- **触发**：用户反馈在 devcontainer / SSH 等场景里走不通 loopback callback，
  问最新 OpenAI 是否提供"无浏览器 code 方式"——查上游确认有

**取了**：

| 类目 | 内容 |
| --- | --- |
| 端点（usercode） | `POST https://auth.openai.com/api/accounts/deviceauth/usercode` body `{client_id}` → `{device_auth_id, user_code, interval}` |
| 端点（poll token） | `POST https://auth.openai.com/api/accounts/deviceauth/token` body `{device_auth_id, user_code}` → 200 `{authorization_code, code_verifier, code_challenge}`; 403/404 = 还没授权按 interval 继续 poll；其他 = 错 |
| 用户验证页 | `https://auth.openai.com/codex/device`（用户在任意联网设备打开输入 user_code） |
| 二阶段 redirect_uri | `https://auth.openai.com/deviceauth/callback`（字面量；服务器不会真的重定向，只用作 OAuth code/PKCE 绑定校验） |
| PKCE 来源 | 服务器在 token poll 200 响应里返回 `code_verifier` + `code_challenge`，客户端**不要**自己生成 |
| 轮询参数 | 默认 interval 5s（响应中的 `interval` 字段覆盖默认）；总超时 15min |

**实现位置**：

- 常量：`src/config/codex-upstream.ts` (`OPENAI_CODEX_DEVICE_*`)
- defaults：`OPENAI_CODEX_OAUTH_DEVICE_DEFAULTS`
- flow 实现：`src/auth/codex-device.ts`（`requestDeviceUserCode` + `pollDeviceToken`）
- CLI：`auth login` 命令进入时交互式让用户在 loopback / device 之间选

**跳过**：

- CLIProxyAPI 的 `--codex-device-login` 命令行 flag（我们用交互 prompt 替代）
- `--no-browser` 选项（device flow 本身就不要求自动开浏览器；不开 = 用户自己复制 URL）

---

### 2026-04-30 - 初次同步

- **CLIProxyAPI commit**: `8b286e8fb39e1cc95dd86d8923e8baa83dec8722`
- **CLIProxyAPI 提交日期**: 2026-04-30
- **本机 Codex CLI 版本**: 0.125.0
- **本工程对应的 commits**: `a33fb90`（基础设施）+ `88d1620`（OAuth+headers+
  refresh+第一版 body normalize）+ `17b94a3`（补齐完整 body 规范化）

**取了**：

| 类目 | 内容 |
| --- | --- |
| OAuth | client_id / redirect_uri (`http://localhost:1455/auth/callback`) / scope / 3 个额外 query 参数（`prompt=login`, `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`） |
| /responses headers | User-Agent (`codex-tui/0.118.0 ...`), Originator (`codex-tui`), Chatgpt-Account-Id, Accept (stream/json), Connection (Keep-Alive), Session_id (uuid v4) |
| body 字段删除 | 11 个：`previous_response_id`, `prompt_cache_retention`, `safety_identifier`, `stream_options`, `max_output_tokens`, `max_completion_tokens`, `temperature`, `top_p`, `truncation`, `context_management`, `user` |
| body 强制注入 | `stream: true`, `store: false`, `parallel_tool_calls: true`, `include: ["reasoning.encrypted_content"]` |
| body 兜底 | `instructions` 缺失或 null 时塞空串 |
| input 转换 | 字符串 input → `[{type:"message",role:"user",content:[{type:"input_text",text:...}]}]` |
| service_tier | 仅保留 `"priority"`，其他值删除 |
| input role 改写 | `role:"system"` → `role:"developer"` |
| tool 类型归一 | `web_search_preview` / `web_search_preview_2025_03_11` → `web_search` |
| 流式策略 | 上游永远 stream=true；客户端 stream=true 透传 SSE，stream=false 网关聚合 SSE 后返回 `response.completed.response`，必要时用 `response.output_item.done` 回填 `output[]` |
| JWT 解 accountId | 嵌套路径 `payload["https://api.openai.com/auth"].chatgpt_account_id` |

**跳过**：

- prompt cache key（CLIProxyAPI cacheHelper 复用机制；不影响首次正确性）
- image_generation tool 注入（客户端自己想用就发）
- thinking provider / reasoning effort 适配（同上）
- 多 provider translator（OpenAI ↔ Claude ↔ Gemini）
- Antigravity / Anthropic / Gemini / AIStudio executor
- WebSocket executor（SSE 已够用）
- 管理面板 / Redis 队列 / pprof / TLS 服务器
- ALLOWED_FIELDS 客户端字段白名单（v1 曾经用，sync 时改成开放透传 +
  按 CLIProxyAPI 同款方式删 known-bad）

**修复的 bug**：

- 之前 `src/auth/jwt.ts` 的 `resolveJwtAccountId` 用错了 JWT 路径（`"a.b"` 字面 key 而非嵌套对象访问）。
  之前 import-codex-cli 路径能读到 accountId 是因为它直接读 auth.json 文件，没走 JWT 解码。
  纯 OAuth 登录路径会因此拿不到 accountId。本次同步一并修。

**真实环境验证结果**：

- 终端 1 跑 `pnpm dev -- serve`，终端 2 跑 `pnpm check:all` 全 ✓
- 非流式：网关聚合后返回完整中文回答
- 流式：17 个 SSE 事件正确逐 chunk 拆分（response.created → in_progress →
  output_item.added → content_part.added → 多个 output_text.delta → done →
  completed），模型 delta 逐字到达
