# AnyTLS（sing-box）一键部署

在干净的 Ubuntu 24.04 VPS 上一键部署 sing-box 服务端，开启 AnyTLS inbound——**2026 年抗探测主流方案**，是 ShadowTLS v3 的下一代替代。

## 为什么选 AnyTLS

- **自带 TLS 伪装 + 认证 + 数据通道**，不像 ShadowTLS 还要叠 Snell/SS 后端，部署只跑一个 sing-box 进程
- **内置 padding 方案**，针对 post-handshake 流量特征做整形，对抗 Aparecium 类指纹工具的设计意图比 ShadowTLS v3 更新
- **Surge 原生支持**：iOS 5.17.0+ / Mac 6.4.3+
- **多设备**：本脚本第一版只配单密码（不做多用户）

## 前置条件

- **操作系统**：Ubuntu 24.04
- **权限**：root（用 `sudo`）
- **网络**：能访问 `api.github.com` 和 `github.com` release CDN
- **防火墙**：放行 TCP/`LISTEN_PORT`（默认 443）
- **客户端**：见下方「客户端选型」

## 端到端部署流程

完整一遍走下来大概 3 分钟（不含 VPS 创建时间）：

1. **买 / 准备一台 Ubuntu 24.04 VPS**（任意厂商：Vultr / Linode / AWS Lightsail / 阿里云国际 等）
2. **在云厂商面板放行 TCP/443**（默认端口；改了 `LISTEN_PORT` 就放行那个）—— 这一步**经常被遗漏**，导致脚本装完但客户端连不上
3. **SSH 登上 VPS**：`ssh root@<你的VPS_IP>`（或 `ssh ubuntu@<IP>` 视厂商默认账户而定，需要 sudo 权限）
4. **跑 install.sh**（见下方 Quickstart）
5. **从终端输出复制配置 / 扫码导入**到客户端
6. **想再看配置**：随时 `sudo bash print-qr.sh`

> 📌 整个流程**只在 VPS 上执行**，本地什么都不用装。

## Quickstart（自签证书，最简）

**前置：你已 SSH 登在 VPS 上，且是 root 或有 sudo 权限。**

```bash
# 1) 下载脚本到 VPS
curl -fsSL -o install.sh https://raw.githubusercontent.com/0x-zeros/web3-tycoon-tools/main/vps-tools/anytls/install.sh

# 2) 运行
sudo bash install.sh

# 3) 终端会输出 anytls:// URI、Surge 配置行、ANSI 二维码——按客户端粘贴或扫码即可
```

## Quickstart（真实域名 + ACME 证书，更干净）

如果你有域名，且 DNS 已解析到这台 VPS：

```bash
# 同样先 SSH 上 VPS，再下载脚本
curl -fsSL -o install.sh https://raw.githubusercontent.com/0x-zeros/web3-tycoon-tools/main/vps-tools/anytls/install.sh

sudo DOMAIN=my.example.com EMAIL=me@x.com bash install.sh
```

sing-box 会自己向 Let's Encrypt 申请证书并自动续期；客户端**不需要** skip-cert-verify。

## 自定义参数

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `LISTEN_PORT` | `443` | 对外端口。建议保持 443 或常见 alt-HTTPS 端口；不要选 5 位随机高端口 |
| `SNI` | `www.cloudflare.com` | 伪装 SNI；自签证书时用作 CN |
| `DOMAIN` | 空 | 提供则启用 ACME 真实证书 |
| `EMAIL` | 空 | ACME 注册邮箱（DOMAIN 提供时必填） |
| `SINGBOX_VER` | 自动 | 自动从 GitHub release latest 抓 |
| `ALLOW_ACME_NON_443` | `0` | ACME + 非 443 时必须设为 `1` 才允许继续（不推荐） |

示例：
```bash
sudo SNI=www.microsoft.com bash install.sh
sudo LISTEN_PORT=8443 bash install.sh                          # 不推荐改高，443 更隐蔽
sudo DOMAIN=my.example.com EMAIL=me@x.com bash install.sh      # ACME 模式
sudo DOMAIN=my.example.com EMAIL=me@x.com LISTEN_PORT=8443 ALLOW_ACME_NON_443=1 bash install.sh  # 仅确认签发链路可用时
```

## 事后再看配置 / 打印二维码

安装时凭据只在终端打印一次。后续想再看（或想用二维码扫码导入到客户端），SSH 上 VPS 跑：

```bash
# 1) 下载 print-qr.sh（与 install.sh 是独立文件，第一次跑要先下载）
curl -fsSL -o print-qr.sh https://raw.githubusercontent.com/0x-zeros/web3-tycoon-tools/main/vps-tools/anytls/print-qr.sh

# 2) 跑（默认：打印 anytls:// URI + Surge 配置行 + 终端 ANSI 二维码）
sudo bash print-qr.sh

# 其它用法
sudo bash print-qr.sh --no-qr                  # 只要文字，不渲染 QR
sudo bash print-qr.sh --png /tmp/anytls.png    # 同时把二维码保存成 PNG
sudo bash print-qr.sh --uri-only               # 只打 anytls:// URL（管道友好）
sudo bash print-qr.sh --surge-only             # 只打 Surge 行
```

二维码内容是标准的 [`anytls://` URI](https://github.com/anytls/anytls-go/blob/main/docs/uri_scheme.md)，**用手机扫即可导入**。

## 客户端选型

| 平台 | 客户端 | 导入方式 |
| --- | --- | --- |
| iOS | [Shadowrocket](https://apps.apple.com/app/shadowrocket/id932747118) | 扫 QR 或粘贴 `anytls://` URI |
| iOS / macOS | Surge（[iOS](https://apps.apple.com/app/surge-5/id1442620678) / [Mac](https://nssurge.com/)） | 粘贴 "Surge 配置行"（不解析 `anytls://` URI） |
| Windows / Linux | [v2rayN](https://github.com/2dust/v2rayN) 7.14.6+ | 复制 `anytls://` URI 后用"从剪贴板导入批量URL" |
| Android | [NekoBox for Android](https://github.com/MatsuriDayo/NekoBoxForAndroid) | 扫 QR |

## 自签 vs ACME 怎么选

| | 自签（默认） | ACME |
| --- | --- | --- |
| 需要域名 | ❌ | ✅ |
| 客户端配置 | 必须 `skip-cert-verify=true` | 不需要 |
| 证书可信链 | 自己签自己 | Let's Encrypt 真实链 |
| 抗探测效果 | 同 | 同（AnyTLS 抗探测靠 padding 不靠证书） |
| 适合场景 | 个人用、不想买/解析域名 | 想"长得更像普通网站"、有域名 |

**抗探测效果上两者等价**，AnyTLS 的伪装不是靠证书合法性，而是靠 `padding_scheme`。

## 端口选择哲学

跟 ShadowTLS 一样，TLS 伪装协议**越像普通 HTTPS 服务越安全**：

- 🟢 推荐：`443`（最隐蔽）、`8443`、`2053`、`2083`、`2087`、`2096`、`8880`（合法 alt-HTTPS）
- 🔴 不推荐：`35621`、`48893` 等纯随机高端口——主动探测时"5 位端口跑 TLS"反而是异常信号

## 故障排查

```bash
# 看实时日志
sudo journalctl -u sing-box -f

# 看监听端口
sudo ss -tlnp | grep ':443'

# 看服务状态
sudo systemctl status sing-box

# 看配置（含密码，注意保密）
sudo cat /etc/sing-box/config.json
```

## 安全提示

- AnyTLS 配置含密码，文件权限默认 `640`，只有 `sing-box` 用户和 root 能读
- 自签证书模式下，客户端 `skip-cert-verify=true` 意味着不校验服务端证书——**正常使用没问题**，但如果你的设备有人能控制网络且想中间人攻击你的 AnyTLS 流量，理论上能伪造服务端。个人场景下可接受
- ACME 模式下 sing-box 会在 `/etc/sing-box/acme/` 缓存账号和证书，请勿手动删除

## 服务管理 / 停止 / 卸载

服务名：`sing-box.service`。所有命令在 VPS 上以 sudo 跑。

### 临时停止 / 启动 / 重启（保留安装，随时再开）

```bash
sudo systemctl stop sing-box        # 停服务（连接立即断；配置/凭据/二进制都保留）
sudo systemctl start sing-box       # 启动
sudo systemctl restart sing-box     # 重启（改了配置后用）
sudo systemctl status sing-box      # 看当前状态（active / inactive / failed）
```

### 禁用 / 启用开机自启

```bash
sudo systemctl disable sing-box         # 禁用自启：VPS 重启后服务不会自动起
sudo systemctl enable  sing-box         # 重新启用自启
sudo systemctl disable --now sing-box   # 一步：停止 + 禁用自启
sudo systemctl enable  --now sing-box   # 一步：启用自启 + 立即启动
```

### 完全卸载

`uninstall.sh` 跟 `install.sh` 是独立文件，第一次卸载要先下载：

```bash
# 1) 下载 uninstall.sh
curl -fsSL -o uninstall.sh https://raw.githubusercontent.com/0x-zeros/web3-tycoon-tools/main/vps-tools/anytls/uninstall.sh

# 2) 跑（幂等：未装过的环境跑也安全）
sudo bash uninstall.sh
```

**会清理**：

- systemd 服务（`sing-box.service`）
- 配置目录 `/etc/sing-box`（含自签证书 + ACME 缓存 `/etc/sing-box/acme/`）
- 二进制 `/usr/local/bin/sing-box`
- 系统用户 `sing-box`

**不会动**：你的云厂商 Security Group / 防火墙规则（端口要不要关请自己去 AWS/Linode 控制台改）。

### 临时停止 vs 卸载怎么选

| 场景 | 选哪个 |
| --- | --- |
| 不用一阵子，过几天还要用 | `systemctl stop` |
| VPS 用作其它用途，不再需要代理 | `uninstall.sh` |
| 改默认端口 / 切自签↔ACME | `uninstall.sh` 后用新参数重装 install.sh |
| 改密码 | `uninstall.sh` 后重装（密码每次随机生成） |
