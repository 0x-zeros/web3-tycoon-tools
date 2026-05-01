# ai-gateway-smoke

AI 网关的真实环境冒烟测试客户端。

通过 HTTP 与 `ai-gateway` 解耦：本工程不依赖、不引用主项目源码或类型，
只通过 `fetch` 调用主项目暴露的 HTTP 接口，验证端到端可用性。

## 前置条件

1. **AI 网关已登录**（满足以下任一）：
   - 已在另一终端跑过 `pnpm dev -- auth login` 完成 OAuth 登录；或
   - 已用 `pnpm dev -- auth import-codex-cli --takeover` 把 Codex CLI 凭据接管过来。
2. **AI 网关 serve 在跑**（默认监听 `127.0.0.1:8787`）：
   ```bash
   cd ../ai-gateway
   pnpm dev -- serve
   ```
3. **可选：API token**。如果启动 serve 时传了 `AI_GATEWAY_API_TOKEN`，
   测试侧也要把同样的值通过 `AI_GATEWAY_API_TOKEN` 传进来。

## 安装

```bash
pnpm install
```

## 命令

### 开发期命令

| 命令 | 干啥 |
| --- | --- |
| `pnpm install` | 装依赖（只有 tsx / typescript / @types/node） |
| `pnpm test` | 跑纯函数单测（27 个）：parseEnv / scanSensitive / SseChunkSplitter |
| `pnpm typecheck` | TypeScript 严格模式校验，不写 dist |

### 真实环境冒烟测试命令

每个 check 都打到运行中的 AI 网关 HTTP 端口，**会消耗 OpenAI 账号额度**
（responses 系列每次约 1 次模型调用）。

| 命令 | 干啥 | 何时用 |
| --- | --- | --- |
| `pnpm check:health` | `GET /health`，断言 200 + `{ok: true}`。**不**调上游模型 | 想确认网关进程活着 |
| `pnpm check:status` | `GET /status`，打印 auth / models / provider 三段；用敏感串扫描器扫整个响应，命中 JWT 头 / Bearer 头则失败。**不**调上游模型 | 想看登录态、provider 限流状态、敏感数据是否泄漏 |
| `pnpm check:responses` | `POST /v1/responses`（`stream: false`），prompt 是「用一句话回答：现在能正常调用上游吗？」。期待 200 + JSON，会从 `output[].content[].text` 提取并打印模型回答。**调一次上游** | 想验证非流式聚合路径（网关消费完上游 SSE 后返回 JSON） |
| `pnpm check:responses:stream` | 同 prompt，但 `stream: true`，逐 chunk 打印 SSE 事件（标注每 chunk 字节数）。**调一次上游** | 想验证 SSE 透传路径，看模型 delta 是否逐字到达 |
| `pnpm check:errors` | 不调上游，触发三种错误码：`unknown_model_alias`（用未知 model alias）/ `invalid_json`（发非法 JSON）/ `unauthorized`（仅当设置了 API token） | 验证错误体格式正确 |
| `pnpm check:all` | 顺序跑前 5 个 check，全 ✓ 退 0；遇错立即退 1 | 端到端最小验收，**会调上游 2 次** |

### 故意不发某些字段

`check:responses` / `check:responses:stream` **故意**不发送 `instructions`，
模拟"什么都不知道的 OpenAI 兼容客户端"。网关侧的 normalize 会兜底为空串，
这正是要验证的行为。客户端不应该需要懂 Codex 上游的特殊约束。

## 环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_GATEWAY_BASE_URL` | `http://127.0.0.1:8787` | AI 网关 HTTP 入口；末尾斜杠会被自动去掉 |
| `AI_GATEWAY_API_TOKEN` | (空) | 当 serve 启用了 API token 时必填，会以 `Authorization: Bearer ...` 透传 |
| `AI_GATEWAY_MODEL_ALIAS` | `codex-default` | 调 `/v1/responses` 时的 model alias |

## 典型用法

### 1. 本地最小验收

```bash
# 终端 1
cd ../ai-gateway
pnpm dev -- serve

# 终端 2
pnpm install
pnpm check:all
```

### 2. 远程或自定义端口

```bash
AI_GATEWAY_BASE_URL=http://10.0.0.5:8787 \
AI_GATEWAY_API_TOKEN=change-me \
pnpm check:all
```

### 3. 单项重跑

```bash
pnpm check:status
pnpm check:responses:stream
```

## 设计约束

- **零运行时依赖**：只用 Node 自带 `fetch` / `node:test` / `node:assert/strict`，
  不引入 axios / undici / vitest / jest 等。
- **TDD 纪律**：纯函数（参数解析、敏感串扫描、SSE 拆分）有单测；
  HTTP 调用层只在真实集成里验证。
- **非交互输出**：每个检查打印 `✓` / `✗` + 简短中文描述，遇错立即非零退出，
  方便复制粘贴到 issue 里。
- **不知任何 token**：本工程不接触 `~/.ai-gateway/credentials.json`；
  所有凭据由主项目自己加载与刷新。
- **不接触上游 OpenAI**：所有请求只打到本地 AI 网关，由网关代发上游。
  本工程 `fetch` 永远不直接打 chatgpt.com。

## 目录

```
ai-gateway-smoke/
├── package.json
├── tsconfig.json
├── README.md
├── CLAUDE.md
├── scripts/
│   └── run-tests.mjs
├── src/
│   ├── checks/        # 6 个 check 入口
│   │   ├── all.ts
│   │   ├── errors.ts
│   │   ├── health.ts
│   │   ├── responses-stream.ts
│   │   ├── responses.ts
│   │   └── status.ts
│   └── utils/
│       ├── env.ts        # parseEnv（有单测）
│       ├── http.ts       # fetch 包装
│       ├── print.ts      # ✓/✗/info 输出
│       ├── sensitive.ts  # scanSensitive（有单测）
│       └── sse.ts        # SseChunkSplitter（有单测）
└── tests/
    ├── env.test.ts
    ├── sensitive.test.ts
    └── sse.test.ts
```
