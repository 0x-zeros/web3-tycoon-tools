# 应急手册：smoke 红了 / 上游突变怎么办

ai-gateway 的 Codex 行为派生自 OpenAI 上游约束。OpenAI 偶尔会改 Codex /responses 的协议、
header 要求或 OAuth flow，导致我们这边突然报错。本档是出现"昨天还能用今天就不行"时的处置流程。

## 触发条件（任一）

- `pnpm check:all`（ai-gateway-smoke）失败，且**主项目代码没改过**
- 真实使用中突然 401 / 400 / 403 / 上游错误码异常
- 客户端（Cline / Aider / Roo 等）报"unsupported field"或"required field missing"

## 第一步：定位是哪一类问题

```bash
# 跑 health 与 status，确认网关本身还活着
cd /workspace/ai-gateway-smoke
pnpm check:health
pnpm check:status
```

| 现象 | 类型 |
| --- | --- |
| `check:health` 失败 | 网关进程问题，看 serve 终端日志 |
| `check:status` 显示 `loggedIn: false` 或 `expiresAt` 过期 | 凭据问题，跳到"凭据失效"段 |
| `check:health` ✓ 但 `check:responses` 4xx | **典型上游突变**，进入"上游突变"段 |
| `check:responses:stream` 流卡住 / SSE 解析炸 | SSE event 结构变了，进入"上游 SSE 变更"段 |

## 凭据失效

```bash
# 看当前凭据状态
cd /workspace/ai-gateway
pnpm dev -- auth status
```

如果 `loggedIn: false` 或 `expiresAt` 过去：

- import-codex-cli 路径：`pnpm dev -- auth import-codex-cli --takeover`（host 上 Codex CLI 已重新登录的话）
- OAuth 路径：`pnpm dev -- auth login`

如果 token 还没过期但上游一直 401，可能是 refresh token 被 revoke 了（多端共用 refresh token 抢占）。
重做 import 或 login。

## 上游突变（最常见情况）

上游突变指 chatgpt.com/backend-api/codex/responses 突然要求新字段、拒绝某字段、或换了 header 名字。
触发症状：网关日志里出现 4xx，错误体里有 `"missing required field"`、`"unsupported field"`、
`"invalid header"` 等字样。

**第一动作：跟 CLIProxyAPI 对账**

```bash
cd /workspace/ai-gateway && ./scripts/sync-check.sh
```

把输出贴出来分析。CLIProxyAPI 在 `internal/runtime/executor/codex_executor.go`、
`internal/auth/codex/openai_auth.go` 里十有八九已经更新了应对方式。

**第二动作：定位并 sync**

1. 找上游 commit message 里跟症状相关的（"add X header"、"normalize Y field"）
2. 读改了哪些 lines
3. 把对应常量 / 规则同步到 `src/config/codex-upstream.ts`
4. 如果是 body 规范化或 header 添加，对应改 `src/providers/codex.ts` 或 `src/server/responses.ts`
5. 写一个 TDD 测试覆盖这次行为变化（防止未来回归）
6. 跑 `pnpm test && pnpm typecheck && pnpm build`
7. 跑 smoke 验证
8. 在 `docs/UPSTREAM-SYNC.md` 加一条同步记录

**如果 CLIProxyAPI 没动**：可能我们这边漂了，或者只是 OpenAI 对我们这个账号 / 地区在做灰度。
用 `AI_GATEWAY_DEBUG_CAPTURE=1 pnpm dev -- serve` 抓一份完整请求 / 响应，跟上游对照。

## 上游 SSE 变更

CLIProxyAPI `codex_executor.go` 的 `collectCodexOutputItemDone` 与 `patchCodexCompletedOutput`
处理了一个棘手的 case：上游的 `response.completed` 事件可能不带 `response.output[]`，
要从 `response.output_item.done` 事件聚合。如果上游又变了 SSE event 结构，看那两个函数的最新版。

## 凭据被泄漏 / 误提交

**永远不要 push** `~/.ai-gateway/credentials.json` 或 `~/.codex/auth.json` 到任何 git 仓库。
如果不小心提交了：

1. 立即 `git reset --hard HEAD~N` 回退（且确保没 push）
2. 在 ChatGPT 设置里 revoke 当前 session
3. 重新登录拿新 refresh_token

## 联系人

单用户项目，发生事故就是你自己 debug。本工程没运维，也没 oncall。
真复杂事故另开 CLAUDE session，把症状和这份文档丢给 claude。
