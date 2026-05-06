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

1. **买 / 准备一台 Ubuntu 24.04 VPS**（Linode / Lightsail ，面板可配置端口，源地址网段。linode不要使用22默认ssh端口，容易被攻击，根本连不上，在能连上的时候，第一件事就是换ssh端口。aws的lightsail，要注意网络超额费用非常贵）
2. **云厂商面板放行端口**（AnyTLS 默认 TCP/443；Snell-STLS 默认 TCP/8443）。（为了安全性，尽量添加上源地址网段，把常用的的WiFi的网段以及5G/4G手机的移动网段等都加上去，以后出现连不上的情况下，这边也要检测一下是不是本地的网段变了。变了的话，再加上去。这两个服务器的网页访问并不需要通过VPN就能访问）
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

防御 VPS 被黑分两条路线，**二选一**即可，不必同时上：

##### 路线 A：云厂商 Security Group + 源 IP 白名单（推荐 ⭐）

适合：你已经在 AWS / Linode / Vultr / Lightsail 控制台管 VPS。

```
入站规则（Inbound）：
  - 22 (SSH)        : 源 = 你常用 IP（家/公司）        ← 关键，主动准入
  - 443 (AnyTLS)    : 源 = 0.0.0.0/0                   ← 必须开，客户端来自任意 IP
  - 8443 (Snell-STLS, 如装): 源 = 0.0.0.0/0
  - 其余           : 默认 deny

出站规则（Outbound）：默认全开（VPS 是代理，需访问任意目标）
```

为什么这条路线更优：

- 过滤发生在 **hypervisor / SDN 层**，包到不了 VPS，不耗 VPS 资源
- VPS 即使被 root，攻击者也改不了 SG 规则（要登你云厂商账号）——比 ufw 抗破坏
- UI 防止常见误配置（不会一条规则把 SSH 给自己锁外）
- SSH 源 IP 变（出差/换网络）→ 登云控制台改 SG → 强制经过"账号控制"环节
- **零维护**，没有 fail2ban 那些日志解析、ban 表管理的活

##### 路线 B：主机内 ufw + fail2ban（在 VPS 里做）

适合：你不能限 SSH 源 IP（团队共用、客户演示、四处出差且懒得每次改 SG），或者用的 VPS 厂商防火墙难用。

```bash
# 主机层
sudo apt install ufw fail2ban
sudo ufw default deny incoming
sudo ufw allow 22/tcp     # 或换非 22 减少扫描噪音
sudo ufw allow 443/tcp
sudo ufw enable
# fail2ban 自动 ban 暴力破解 SSH 的 IP
sudo systemctl enable --now fail2ban
```

##### 两条路线都要做的（无论 A/B）

1. 🔴 SSH **禁用密码登录**，只允许 key：`/etc/ssh/sshd_config` 设 `PasswordAuthentication no`
2. 🔴 SSH **禁用 root 直登**：`PermitRootLogin no`，平时用 sudo 用户
3. 🟠 跟着上游升级 sing-box / shadow-tls（脚本默认抓 latest，重装即升）

##### 关于代理端口（443 / 8443）的安全

这俩**必须** `0.0.0.0/0`，因为客户端来自任意 IP。云 SG / ufw / fail2ban 在这里**都无能为力**。代理端口的安全完全靠**密码熵**：

- AnyTLS / ShadowTLS 密码 = `openssl rand -base64 48` = **384 bit 熵**
- 暴力破解尝试次数约 10⁹⁹ —— 宇宙热寂前破不完

所以代理端口的安全靠**密码学**，不靠 IP 过滤。

##### 关于 RESTful API / external-controller 的迷思

- **你这台 VPS（服务端）**：脚本生成的 sing-box `config.json` **完全没有** `experimental.clash_api` / `experimental.v2ray_api` 块，所以根本不存在 RESTful 控制接口可暴露。安全无忧。
- **你 Windows 上的客户端（GUI 内核）**：mihomo / sing-box 客户端默认 `external-controller: 127.0.0.1:9090`，是给本机 GUI 用的，**别改成 `0.0.0.0`**——那是给 GUI 的命令通道，对外开就等于把内核控制权交出去。
