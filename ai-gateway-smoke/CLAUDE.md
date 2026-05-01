# CLAUDE.md — ai-gateway-smoke

## 工程定位

AI 网关（`ai-gateway`）的**真实环境冒烟测试客户端**。

- 与主项目**完全解耦**：不通过 path 引用 / 不共享类型 / 不导入源码；
  只通过 HTTP 调用主项目暴露的接口（`/health` / `/status` / `/v1/responses`）。
- 第一版边界：**单用户、单实例、零运行时依赖**。

## 跟主项目的关系

| 维度 | 主项目 ai-gateway | 本工程 ai-gateway-smoke |
| --- | --- | --- |
| 角色 | HTTP 服务端 + CLI | HTTP 客户端 |
| 凭据存储 | 读写 `~/.ai-gateway/credentials.json` | **不读不写**任何 credential 文件 |
| 端口 | 默认监听 8787 | 默认请求 `http://127.0.0.1:8787` |
| 运行方式 | `pnpm dev -- serve` | `pnpm check:*`（tsx） |
| 依赖 | 0 运行时 + tsx/typescript | 0 运行时 + tsx/typescript |

## 命令速查

```bash
pnpm test                    # 跑纯函数单测
pnpm typecheck               # 类型检查
pnpm check:all               # 跑全部 5 个真实接口检查
pnpm check:health            # 单项：健康
pnpm check:status            # 单项：状态（含敏感串扫描）
pnpm check:responses         # 单项：非流式
pnpm check:responses:stream  # 单项：流式 SSE
pnpm check:errors            # 单项：错误码矩阵
```

## 改动纪律

- 修改纯函数（`src/utils/{env,sensitive,sse}.ts`）必须先动测试再动实现（TDD）。
- HTTP 调用层（`src/utils/http.ts` 与 `src/checks/*`）属于真实集成层，**不补单测**，
  通过 `pnpm check:all` 的真实环境跑通来验证。
- 不引入新的运行时依赖（必须用 Node 内置 `fetch` / `node:test` / `node:assert/strict`）。
  如果需要 axios / undici / vitest，先和我（用户）讨论，本工程的"零依赖"是有意为之。
- 输出风格：`✓` 表示通过、`✗` 表示失败、`·` 表示 info；
  失败立刻 `process.exit(1)`，不打印 stack 噪音。

## 不做的事

- ❌ 不读写 `~/.ai-gateway/`、不接触 credentials/config 文件
- ❌ 不做 mock 上游 OpenAI / Codex，所有 check 都打到真实 AI 网关
- ❌ 不做并发压测、不做 fuzz、不做长跑稳定性测试
- ❌ 不引入 Express / Fastify / k6 / autocannon 等第三方框架

## 何时介入主项目

如果某个 check 在真实环境失败，并且经过排查不是测试本身的问题，那就要回主项目修：

1. 在主项目用 `superpowers:test-driven-development` 写复现测试；
2. 修主项目源码；
3. 跑主项目的 `pnpm test && pnpm typecheck && pnpm build`；
4. 回到本工程重跑 `pnpm check:all`，验证修复。

不要在本工程里"绕开"或"补丁"主项目的 bug。
