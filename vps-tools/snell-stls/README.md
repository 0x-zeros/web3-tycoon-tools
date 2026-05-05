# Snell v5 + ShadowTLS v3 一键部署

在干净的 Ubuntu 24.04 VPS 上一键部署 Snell v5（代理后端）+ ShadowTLS v3（TLS 伪装前端），两个服务都以专用系统用户 `snell` 降权运行。

## 前置条件

- **操作系统**：Ubuntu 24.04（其他发行版会被脚本主动拒绝）
- **权限**：root（用 `sudo`）
- **网络**：能访问 `dl.nssurge.com` 和 `api.github.com`
- **防火墙**：云厂商安全组 + 系统防火墙都要放行 TCP/`STLS_PORT`（默认 8443）

## 端到端部署流程

⚠️ **先决策**：这套组合**只 Surge 能用**。如果你的客户端是 Shadowrocket / Clash Verge Rev / v2rayN 等，请直接换 [`../anytls/`](../anytls/README.md)，下面的步骤就不用看了。

完整一遍走下来大概 3 分钟（不含 VPS 创建时间）：

1. **买 / 准备一台 Ubuntu 24.04 VPS**
2. **云厂商面板放行 TCP/8443**（默认；改了 `STLS_PORT` 就放行那个）—— 经常被遗漏
3. **SSH 登上 VPS**：`ssh root@<你的VPS_IP>`
4. **跑 install.sh**（见下方 Quickstart）
5. **从终端复制 "Snell-STLS = ..." 整行**到 Surge 的 `[Proxy]` 段
6. **想再看配置**：随时 `sudo bash print-qr.sh`

## Quickstart

**前置：你已 SSH 登在 VPS 上，且是 root 或有 sudo 权限。**

```bash
# 1) 下载脚本到 VPS
curl -fsSL -o install.sh https://raw.githubusercontent.com/0x-zeros/web3-tycoon-tools/main/vps-tools/snell-stls/install.sh

# 2) 运行（必须 sudo bash 而不是 ./，因为 curl 下载下来的脚本没有 +x）
sudo bash install.sh

# 3) 看终端输出的 Surge 配置，复制最后那行 "Snell-STLS = ..." 到 Surge
```

## 自定义参数

通过环境变量覆盖默认值：

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `STLS_PORT` | `8443` | ShadowTLS 对外端口。改成 443 更隐蔽，但要确认云厂商默认放行 |
| `TLS_DOMAIN` | `www.cloudflare.com` | 伪装 SNI（你**不需要**拥有这个域名） |
| `TLS_TARGET_PORT` | `443` | 伪装站点端口，通常固定 443 |
| `BACKEND_PORT` | `8388` | Snell 本地端口，仅 `127.0.0.1` 监听，外网看不到 |
| `SNELL_VER` | 自动 | 自动从 Surge KB 抓最新版；抓不到回退 `v5.0.1`。可手动锁版本 |

示例：
```bash
sudo STLS_PORT=443 TLS_DOMAIN=www.microsoft.com bash install.sh
sudo SNELL_VER=v5.0.1 bash install.sh    # 锁定版本
```

## 事后再看配置 / 打印二维码

安装时凭据只在终端打印一次。后续想再看，SSH 上 VPS 跑：

```bash
# 1) 下载 print-qr.sh（与 install.sh 是独立文件，第一次跑要先下载）
curl -fsSL -o print-qr.sh https://raw.githubusercontent.com/0x-zeros/web3-tycoon-tools/main/vps-tools/snell-stls/print-qr.sh

# 2) 跑（默认：打印 Surge 配置行 + 终端 ANSI 二维码；QR 内容是 Surge 配置行的纯文本）
sudo bash print-qr.sh

# 其它用法
sudo bash print-qr.sh --no-qr                       # 只要文字，不渲染 QR
sudo bash print-qr.sh --png /tmp/snell-stls.png     # 把二维码保存成 PNG
sudo bash print-qr.sh --surge-only                  # 只打 Surge 行（管道友好）
```

> ⚠️ **二维码内容只是 Surge 配置行的纯文本**，不是分享链接。原因：Snell v5 + ShadowTLS v3 是 Surge 独家组合，没有跨客户端 URI 标准（`snell://` / `stls://` 都不存在）。
>
> 用相机扫码 → 得到一段文字 → 复制粘贴到 Surge 的 `[Proxy]` 段。

### 客户端兼容（2026-05 时点）

| 客户端 | 平台 | 是否能用 |
| --- | --- | --- |
| **Surge** 6.4.3+ | iOS / macOS | ✅ 唯一原生支持 |
| Shadowrocket 2.2.x | iOS | ❌ Snell 仅支持 v1-3，本服务跑的是 v5 |
| v2rayN 7.x | Windows | ❌ 完全不支持 Snell |
| Clash Verge Rev / Mihomo Party / Karing | 多平台 | ❌ mihomo 内核 Snell 仅到 v3 |

**如果你需要 iPhone+Windows 双平台**，请改用同项目 [`../anytls/`](../anytls/README.md) — AnyTLS 在 Shadowrocket / Clash Verge Rev / v2rayN 都有原生 URI 解析支持，能真正"扫码即导入"。

## 凭据存储位置

- `/etc/snell/snell.conf` — Snell PSK（`snell:snell` 600）
- `/etc/shadowtls/shadowtls.env` — ShadowTLS 密码 + 端口（`root:root` 600；systemd 启动前读取）

> 注意：当前 `shadow-tls` CLI 仍通过 `--password` 接收密码，因此 root 仍可从进程 argv/服务状态中看到该值；`EnvironmentFile` 的作用是避免明文写入 unit 文件，而不是隐藏运行时 argv。

## ⚠️ 安全提示

**ShadowTLS v3 已在 2025-06 之后被 Aparecium 工具识别**——HMAC(PSK) tainting 给 `ServerFinished` 加了 4 字节，永远是 57/73 字节而不是标准的 53/69，构成永久指纹。

- **个人量级 + 普通审查**：仍可用，被针对的概率低
- **强审查 / 商用**：建议升级 [`../anytls/`](../anytls/README.md)，AnyTLS 是 sing-box 的下一代方案，专门针对 post-handshake 指纹问题设计

## 端口选择哲学

TLS 伪装协议的端口选择跟普通服务相反：

- 🟢 **越接近标准 HTTPS 端口越好**：443、8443、2053、2083、2087、2096、8880（都是合法 HTTPS 备用端口）
- 🔴 **不要选 5 位随机高端口**：`35621` 跑 TLS 反而是异常信号，主动探测时一抓一个准

## 故障排查

```bash
# 看实时日志
sudo journalctl -u snell.service -f
sudo journalctl -u shadowtls.service -f

# 看监听端口
sudo ss -tlnp | grep -E ':(8443|8388)'

# 看服务状态
sudo systemctl status snell shadowtls
```

## 服务管理 / 停止 / 卸载

服务名：`snell.service` + `shadowtls.service`（两个），所有命令在 VPS 上以 sudo 跑。

> ℹ️ 两服务的 systemd 关系：`shadowtls.service` 声明了 `Requires=snell.service` + `After=snell.service`。所以 **stop snell 会联动 stop shadowtls；start shadowtls 会联动 start snell**——大多数情况下你只需要操作其中一个。

### 临时停止 / 启动 / 重启（保留安装，随时再开）

```bash
# 停（一次停俩）
sudo systemctl stop snell shadowtls

# 启动（用 shadowtls 即可，systemd 会先把 snell 拉起来）
sudo systemctl start shadowtls

# 重启（改了配置后用）
sudo systemctl restart snell shadowtls

# 看当前状态
sudo systemctl status snell shadowtls
```

### 禁用 / 启用开机自启

```bash
sudo systemctl disable snell shadowtls         # 禁用：VPS 重启后不自动起
sudo systemctl enable  snell shadowtls         # 重新启用
sudo systemctl disable --now snell shadowtls   # 一步：停 + 禁
sudo systemctl enable  --now snell shadowtls   # 一步：启用自启 + 立即跑
```

### 完全卸载

`uninstall.sh` 跟 `install.sh` 是独立文件，第一次卸载要先下载：

```bash
# 1) 下载 uninstall.sh
curl -fsSL -o uninstall.sh https://raw.githubusercontent.com/0x-zeros/web3-tycoon-tools/main/vps-tools/snell-stls/uninstall.sh

# 2) 跑（幂等：未装过的环境跑也安全，每步都"不存在则跳过"）
sudo bash uninstall.sh
```

**会清理**：

- systemd 服务（`snell.service` + `shadowtls.service`）
- 配置目录 `/etc/snell` + `/etc/shadowtls`
- 二进制 `/usr/local/bin/snell-server` + `/usr/local/bin/shadow-tls`
- 系统用户 `snell`

**不会动**：你的云厂商 Security Group / 防火墙规则（端口要不要关请自己去控制台改）。

### 临时停止 vs 卸载怎么选

| 场景 | 选哪个 |
| --- | --- |
| 不用一阵子，过几天还要用 | `systemctl stop snell shadowtls` |
| VPS 改作其它用途 | `uninstall.sh` |
| 想换默认端口 / SNI / 后端端口 | `uninstall.sh` 后用新参数重装 |
| 想换密码 | `uninstall.sh` 后重装（PSK / STLS 密码每次随机） |
| 想换协议到 AnyTLS | 先 `uninstall.sh`，再去 `../anytls/` 装 |
