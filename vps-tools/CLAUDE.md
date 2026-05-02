# CLAUDE.md — vps-tools

## 工程定位

个人**工具集合**项目，按需"一点一点添加东西"。每个工具是独立单元：

- 独立目录、独立 README、独立依赖（如有）
- 工具之间**不共享代码**（小到不值得抽象；不同工具可能用完全不同的语言/技术栈）
- 加新工具不要急着抽公共层；先独立写，等出现真实重复再考虑收敛

## 加新工具的步骤

1. 在 `<工具名>/` 下放代码和资源
2. 写 `<工具名>/README.md`：一句话简介 + 前置条件 + 三行 quickstart + 卸载/清理
3. 在 `vps-tools/README.md` 的"当前可用工具"表里加一行
4. 不要 commit 同时碰多个工具——每次 PR 聚焦一个

## 部署/卸载类脚本必备

- `#!/usr/bin/env bash` + `set -euo pipefail`
- 顶部注释块说清楚：用途、前置条件、用法、所有可调环境变量、输出、卸载方式
- root 守卫（`id -u != 0` 退出）
- 平台守卫（`lsb_release -rs` 校验，不匹配退出）
- 端口占用检查（`ss -tuln`）
- 服务用专用系统用户跑，不要 root（`useradd --system --no-create-home --shell /usr/sbin/nologin --user-group <name>`）
- 敏感串（密码、token）不要明文写进 systemd unit；优先用配置文件/`EnvironmentFile`，并避免进入进程 argv
- 若上游 CLI 只能通过命令行参数接收密码，必须在 README 和脚本注释里明示 argv 风险，并优先跟进 password-file/config 替代
- 装完用 `systemctl is-active` + `ss -tlnp` 双重校验
- 卸载脚本必须把 systemd unit、`/etc` 目录、`/usr/local/bin` 二进制、系统用户**全部**清干净

## 不做的事

- ❌ 不在本地或 devcontainer 中执行 VPS 部署脚本（用户在真实 VPS 上验证）
- ❌ 不抽公共脚本库（各工具自包含）
- ❌ 不做监控、watchdog、面板（保持脚本"装一次就能跑"的纯粹性）
- ❌ 不在脚本里塞跨发行版兼容（明确锁定 Ubuntu 24.04）

## 改动纪律

- 改一个工具不要顺手改另一个
- 对已发布的工具改默认参数（端口、路径）要在 README "Changelog" 或 commit 说明里明示
- 卸载脚本要跟着 install 一起改；不要让 install 写了新东西但 uninstall 没删
