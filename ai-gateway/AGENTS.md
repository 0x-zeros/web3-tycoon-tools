# AGENTS.md

本文件适用于 `ai-gateway`。

## 语言

所有文档、注释、commit 消息、CLI 面向用户的固定文案均使用中文。

## 项目定位

这是仅供个人使用的本地 / 私有 AI 网关。第一版只支持 Codex / ChatGPT subscription OAuth，重点是 OAuth 凭据生命周期稳定，而不是多用户平台。

## 常用命令

- 安装依赖：`pnpm install`
- 运行 CLI：`pnpm dev -- <args>`
- 类型检查：`pnpm typecheck`
- 测试：`pnpm test`
- 构建：`pnpm build`

## 边界

- 不实现多用户、多租户、计费、后台管理、账号池。
- 不使用系统 keychain 作为第一版前提。
- 不在日志、错误、状态页中输出完整 access token 或 refresh token。

## 上游派生常量与同步流程

Codex /responses 行为派生自 OpenAI 上游约束。所有 OAuth 参数、HTTP header、
body 规范化规则集中在 `src/config/codex-upstream.ts`，每条带 provenance 注释。

**改这个文件前必读** `docs/UPSTREAM-SYNC.md`。
**smoke 红了或上游突变** 看 `docs/UPGRADING.md`。
**主动检查上游漂移** 跑 `./scripts/sync-check.sh`。
