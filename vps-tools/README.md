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

## 安全：什么能 commit，什么绝不能

本仓库是 **GitHub public repo**。脚本本身公开**没有任何安全风险**——所有凭据是脚本在 VPS 运行时用 `openssl rand` 当场生成的，仓库里只有逻辑，没有秘密。Kerckhoffs 原则：好的安全只依赖密钥，不依赖隐藏代码。

但**未来 commit 是终生可见的**（即便事后删除，GitHub 缓存和 crawler 会留底）。绝不能进仓库的东西：

| ❌ 绝不 commit | 原因 |
| --- | --- |
| `/etc/sing-box/config.json` 真实部署后的副本 | 含明文 AnyTLS 密码 |
| `/etc/snell/snell.conf` / `/etc/shadowtls/shadowtls.env` | 含 PSK 和 ShadowTLS 密码 |
| 任何包含真实 VPS IP 的脚本/截图/笔记 | 让攻击者锁定靶子 |
| `*.pem` / `*.key` / `id_rsa*` / `id_ed25519*` | SSH/TLS 私钥 |
| `print-qr.sh --png` 输出的 PNG/SVG | 二维码包含完整凭据 |
| `.env` / 任何 `*.env.local` | 通常含 token/API key |
| 云厂商 API key（AWS/Vultr/Linode） | 直接接管账户 |

仓库根 `.gitignore` 已经预过滤了上面这些常见模式。但永远不要 `git add .`——总是显式 add 你检视过的文件。

#### 真要降 VPS 被黑概率，做这些（跟 GitHub 无关）

按攻击概率排：

1. 🔴 SSH **禁用密码登录**，只允许 key（`PasswordAuthentication no` in `/etc/ssh/sshd_config`）
2. 🔴 SSH **禁用 root 直接登录**（`PermitRootLogin no`），用 sudo 用户
3. 🔴 SSH 端口换非 22（不是真安全，但能挡掉 99% 的扫描 bot 噪音）
4. 🟠 装 `fail2ban`，自动 ban 暴力破解 IP
5. 🟠 防火墙 `ufw` 只放需要的端口（443 + 22，其余 default deny）
6. 🟠 跟着上游升级 sing-box / shadow-tls（脚本默认抓 latest）
7. 🟡 `mihomo` / `sing-box` 的 RESTful API 默认只听 `127.0.0.1`，**不要手贱改成 `0.0.0.0`**
