# vps-tools

个人 VPS 工具集合。每个工具自成一体（独立目录、独立依赖、独立 README），按需逐个加入。

## 当前可用工具

| 路径 | 用途 | 平台 |
| --- | --- | --- |
| [`anytls/`](./anytls/README.md) | AnyTLS（sing-box）一键部署/卸载 | Ubuntu 24.04 VPS |
| [`snell-stls/`](./snell-stls/README.md) | Snell v5 + ShadowTLS v3 一键部署/卸载 | Ubuntu 24.04 VPS |

## 怎么选（代理协议）

| 你的客户端 | 推荐 | 原因 |
| --- | --- | --- |
| **iOS Shadowrocket** + Windows / Android | [`anytls/`](./anytls/README.md) | AnyTLS 是跨平台首选，有标准 `anytls://` URI，扫码即导入 |
| **只用 Surge**（iOS+Mac）且想要 Snell v5 性能 | [`snell-stls/`](./snell-stls/README.md) | Snell v5 + ShadowTLS v3 仅 Surge 支持 |
| 拿不准 | [`anytls/`](./anytls/README.md) | 安全裕度更新，跨客户端最广 |

## 端到端部署流程（通用）

每个工具的 README 里都有详细 Quickstart。统一流程：

1. **买 / 准备一台 Ubuntu 24.04 VPS**（Vultr / Linode / Lightsail / 阿里云国际 任意厂商）
2. **云厂商面板放行端口**（AnyTLS 默认 TCP/443；Snell-STLS 默认 TCP/8443）
3. **SSH 登 VPS**：`ssh root@<你的VPS_IP>`
4. **跑安装脚本**：`curl -fsSL -o install.sh <脚本URL> && sudo bash install.sh`
5. **从终端复制配置**到客户端（或扫终端二维码）
6. **想事后再看配置**：在 VPS 上 `sudo bash print-qr.sh`
7. **不用了**：`sudo bash uninstall.sh` 完整清理

> 📌 完整命令各工具 README 的 Quickstart 节里有，复制粘贴即可。

## 目录组织

```
vps-tools/
├── README.md       ← 本文件，工具索引
├── CLAUDE.md       ← 项目级 AI 协作指导
└── <工具>/         ← 每个工具一个目录，自带 README
```

## 通用约定

- 文档、注释、commit 一律中文
- 部署/卸载类脚本必须有：root 守卫、平台守卫、参数注释、卸载脚本
- 部署脚本默认绝不在本地执行，只在目标环境验证
