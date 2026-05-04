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
- **客户端**：Surge iOS 5.17.0+ 或 Mac 6.4.3+

## Quickstart（自签证书，最简）

```bash
# 1) 下载到 VPS
curl -fsSL -o install.sh https://raw.githubusercontent.com/0x-zeros/web3-tycoon-tools/main/vps-tools/anytls/install.sh

# 2) 运行
sudo bash install.sh

# 3) 复制终端输出的 "AnyTLS = ..." 到 Surge
#    Surge 客户端必须勾选 skip-cert-verify=true（脚本输出已自动带上）
```

## Quickstart（真实域名 + ACME 证书，更干净）

如果你有域名，且 DNS 已解析到这台 VPS：

```bash
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

安装时凭据只在终端打印一次。后续想再看（或想用二维码扫码导入到客户端）：

```bash
# 默认：打印 anytls:// URI + Surge 配置行 + 终端 ANSI 二维码
sudo bash print-qr.sh

# 只要文字，不渲染 QR
sudo bash print-qr.sh --no-qr

# 同时把二维码保存成 PNG（方便发到其它设备）
sudo bash print-qr.sh --png /tmp/anytls.png

# 管道友好：只打 anytls:// URL 或只打 Surge 行
sudo bash print-qr.sh --uri-only
sudo bash print-qr.sh --surge-only
```

二维码内容是标准的 [`anytls://` URI](https://github.com/anytls/anytls-go/blob/main/docs/uri_scheme.md)，**用手机扫即可导入**。

### 客户端选型（2026-05 时点）

#### 各平台一句话推荐

| 平台 | 首选 | 导入方式 |
| --- | --- | --- |
| **iOS** | Shadowrocket 2.2.x | 扫 QR / 粘贴 `anytls://` URI |
| **macOS** | Surge 6.4.3+ | 粘贴上面的 "Surge 配置行"（Surge 不解析 `anytls://`） |
| **Windows** | **Clash Verge Rev** v2.4.5+ | 扫 QR / 粘贴 `anytls://` URI |
| **Linux** | Clash Verge Rev / sing-box-windows | 扫 QR / 粘贴 `anytls://` URI |
| **Android** | NekoBox / sing-box for Android (SFA) | 扫 QR |

> ⚠️ **Surge 不支持 `anytls://` URI**——只能粘贴 Surge 配置行。其它客户端都能扫码。

#### Windows 三选一详细对比

如果你跟我一样还会同时用 **TUIC+TLS** 和 **VLESS+Reality**，下面是这三个 Windows 客户端的完整对比：

| 维度 | **Clash Verge Rev** v2.4.7 | **sing-box-windows** v2.3.0 | **v2rayN** 7.21+ |
| --- | --- | --- | --- |
| 内核 | mihomo (Clash.Meta) | sing-box（纯） | Xray + sing-box（**双内核**） |
| AnyTLS | ✅ + URI 解析（v2.4.5+） | ✅ + URI 解析（紧贴上游） | ✅ + URI 解析（强制走 sing-box） |
| TUIC v5 + TLS | ✅ mihomo 原生 | ✅ sing-box 原生 | ✅ sing-box only（自动切内核） |
| VLESS + Reality | ✅ + `vless://` URI | ✅ + `vless://` URI | ✅（Xray 或 sing-box 都行） |
| TUN 模式 | ✅ 开箱 | ✅ | ✅ |
| 系统托盘/自启 | ✅ | ✅ | ✅ |
| UI 现代度 | ⭐⭐⭐⭐⭐ Tauri 2 | ⭐⭐⭐⭐ Tauri 2 + Vue 3 | ⭐⭐ WPF 老派 |
| 多内核切换 | ❌ mihomo only | ❌ sing-box only | ✅ 唯一双内核 |
| GitHub 热度 | 116k★，月度发布 | 持续维护 | 持续维护 |
| 协议跟进 | mihomo 跟上游 sing-box（中速） | 紧贴 sing-box 上游（最快） | 取决于内核 |

**结论**：

- **首选 Clash Verge Rev** — 三协议全覆盖 + URI 直接导入 + UI 最好 + 生态最大。日常用就它。
- **次选 sing-box-windows** — AnyTLS / TUIC v5 是 sing-box 独家协议，它跟得最快。如果哪天 mihomo 跟进上游慢（比如 AnyTLS padding 调优），换它。
- **兜底 v2rayN** — 唯一双内核，VLESS+Reality 想用 Xray "原生家"实现的话只此一家。但 UI 最老派。

**一句话：日常 Clash Verge Rev，备一份 sing-box-windows 应急。**

#### 各客户端导入操作

**📱 Shadowrocket (iOS)**
- 首页右上角 ➕ → "扫描二维码" → 对准 QR

**💻 Clash Verge Rev (Windows/Mac/Linux, v2.4.5+)**
- 主界面 → 代理 → 节点编辑 → 粘贴 `anytls://` URI
- 或：扫码工具识别 QR 后复制 URI 到节点编辑框

**💻 sing-box-windows (Windows/Mac/Linux)**
- 订阅页 → "节点链接 / YAML" 模式 → 粘贴 `anytls://` URI

**💻 v2rayN (Windows, 7.14.6+)**
- 复制 `anytls://` URI 到剪贴板 → 服务器菜单 → "从剪贴板导入批量URL"

**🍎 Surge (macOS / iOS)**
- 不解析 `anytls://` URI；把 Surge 配置行整行粘到 `[Proxy]` 段下

## 卸载

```bash
sudo bash uninstall.sh
```

清理：systemd 服务、`/etc/sing-box`（含自签证书和 ACME 缓存）、`/usr/local/bin/sing-box`、系统用户 `sing-box`。

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
