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

#### Windows 客户端四选一详细对比

如果你同时还会用 **TUIC+TLS** 和 **VLESS+Reality**，下面是四个主流 Windows 客户端的完整对比。**重点关注两个 UX 维度：启动可靠性 + 规则可读性**。

| 维度 | **Clash Party** v1.9.4 *(原 Mihomo Party)* | **Clash Verge Rev** v2.4.7 | **sing-box-windows** v2.3.0 | **v2rayN** 7.21+ |
| --- | --- | --- | --- | --- |
| 内核 | mihomo | mihomo | sing-box（纯） | Xray + sing-box（**双内核**） |
| AnyTLS | ✅ + URI 解析 | ✅ + URI 解析（v2.4.5+） | ✅ + URI 解析 | ✅ + URI 解析（强制走 sing-box） |
| TUIC v5 + TLS | ✅ mihomo 原生 | ✅ mihomo 原生 | ✅ sing-box 原生 | ✅ sing-box only |
| VLESS + Reality | ✅ + `vless://` URI | ✅ + `vless://` URI | ✅ + `vless://` URI | ✅（Xray 或 sing-box） |
| **规则语法** | **Surge 同源**（mihomo YAML） | **Surge 同源**（mihomo YAML） | sing-box JSON（陌生） | Xray routing JSON（**最复杂**） |
| **TUN 启动** | ✅ 直接启动，记住状态 | ✅ 直接启动，记住状态 | ✅ | ⚠️ **每次重启不持久**（[#8066](https://github.com/2dust/v2rayN/issues/8066)） |
| **状态清晰度** | 托盘图标 + 一键开关 | 托盘图标 + 一键开关 | 托盘图标 | 多种模式切换易迷惑 |
| 启动速度 | 快（Electron） | 中（Tauri+WebView） | 中 | 慢 |
| UI 现代度 | ⭐⭐⭐⭐ Electron + Vue | ⭐⭐⭐⭐⭐ Tauri 2 | ⭐⭐⭐⭐ Tauri+Vue 3 | ⭐⭐ WPF 老派 |
| 多内核切换 | ❌ mihomo only | ❌ mihomo only | ❌ sing-box only | ✅ 唯一双内核 |
| GitHub | 23.3k★，月更 | 116k★，月更 | 持续维护 | 持续维护 |
| 维护状态 | 活跃（2026-03 v1.9.4） | 活跃（2026-03 v2.4.7） | 活跃（2026-04 v2.3.0） | 活跃，但 TUN 痛点未解 |

> **关于 Clash Party 改名**：原名 Mihomo Party，2025 秋更名（mihomo 内核作者修改使用条款，禁止上层软件名带 "Mihomo"）。GitHub 仓库 [`mihomo-party-org/clash-party`](https://github.com/mihomo-party-org/clash-party)。

##### 规则语法对比（用 Shadowrocket / Surge 看会很熟）

| Surge / Shadowrocket | Clash Party / Clash Verge Rev (mihomo) | v2rayN (Xray) |
| --- | --- | --- |
| `DOMAIN-SUFFIX,google.com,PROXY` | `- DOMAIN-SUFFIX,google.com,PROXY` | `{"type":"field","domain":["domain:google.com"],"outboundTag":"proxy"}` |
| `IP-CIDR,8.8.8.8/32,PROXY` | `- IP-CIDR,8.8.8.8/32,PROXY` | `{"type":"field","ip":["8.8.8.8/32"],"outboundTag":"proxy"}` |
| `GEOIP,CN,DIRECT` | `- GEOIP,CN,DIRECT` | `{"type":"field","ip":["geoip:cn"],"outboundTag":"direct"}` |

**mihomo 的规则语法直接继承自 Surge**——你 Shadowrocket / Surge 配置文件那一套规则名（`DOMAIN-SUFFIX` / `IP-CIDR` / `GEOIP` / `RULE-SET`...）拿过来基本就能用，YAML 包一层而已。Xray routing JSON 是完全另一套抽象（tag-based outbound、`domain:` / `geosite:` 前缀），看着费劲。

##### v2rayN 的 TUN 痛点（你已经踩到了）

社区跟踪 issues 包括：

- [#8066 / #8069](https://github.com/2dust/v2rayN/issues/8066) — TUN 状态不在 app 重启间持久化（你遇到的就是这个）
- [#3035](https://github.com/2dust/v2rayN/issues/3035) — 系统重启后 TUN 自动关闭
- [discussion #7471](https://github.com/2dust/v2rayN/discussions/7471) — Windows 11 24H2 重启后 TUN 工作短暂时间后死

作者已收到反馈，但截至 2026-05 还没出 "Persistent TUN Mode" 特性。

##### 推荐排序（按你的诉求：启动可靠 + 规则易读 + AnyTLS/TUIC/Reality 全支持）

1. 🥇 **Clash Party（原 Mihomo Party）** — TUN 启动直接、状态持久；mihomo 规则语法跟你熟悉的 Surge/Shadowrocket 同源；Electron 启动比 Tauri+WebView 快一截。**这是替代 v2rayN 的最舒服的选择**。
2. 🥈 **Clash Verge Rev** — 跟 Clash Party 内核完全相同（都是 mihomo），UI 更精致，生态更大（116k★），webview 启动稍慢。两者选哪个看个人审美。
3. 🥉 **sing-box-windows** — sing-box 独家协议（AnyTLS / TUIC v5）跟上游最快；但规则语法是 sing-box JSON，跟 Surge 不同源，看着不亲切。当备用客户端用。
4. ❌ **v2rayN** — TUN 持久化未解决 + Xray routing JSON 规则啰嗦。**建议放弃。**

**一句话：换到 Clash Party，它是 mihomo 内核的 GUI 里最贴近你"启动即用、规则像 Surge"诉求的选项。**

#### 安装安全性评估

代理客户端**必然**要：跑在管理员权限装 TUN 驱动 / 看你所有流量 / 持有 VPS 凭据。所以装哪个软件本身就是高信任行为。下面是按"愿意装到自己电脑上"的安全感排序：

| 客户端 | 开源 | 协议 | 社区规模 | 框架（攻击面） | GPG 签名 | 已知安全事件 | 我的信任度 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Clash Verge Rev** | ✅ GitHub | GPL-3.0 | 116k★，多 contributor | Tauri+Rust（**小**） | 部分 | 无 | 🟢 高 |
| **Clash Party** | ✅ GitHub | MIT | 23.3k★，多 contributor | Electron（**大**） | ✅ 全部签（key `B5690EEEBB952194`） | 无 | 🟢 高 |
| **sing-box-windows** | ✅ GitHub | MIT | ~千级，**单维护者** xinggaoya | Tauri+Vue（小） | 无 | 无 | 🟡 中（单点） |
| **v2rayN** | ✅ GitHub | GPL-3.0 | 数万★，单主维护者 2dust | WPF/.NET（中） | 无 | ⚠️ [#4832](https://github.com/2dust/v2rayN/issues/4832) v6.39 被 4 杀软标红，维护者未回应 | 🟠 偏低 |

##### 几条原则你必须知道

1. **杀软误报极常见**：Microsoft Defender 把 V2Ray/Xray/sing-box 二进制标记为 `Trojan:Win32/Wacatac.C!ml` 是常态，**不代表真有病毒**。代理软件作者付不起 AV 厂商的代码签名认证费用（每年几千刀），所以新版本经常被启发式引擎误判。
2. **永远从 GitHub 官方 Release 下**：不要用第三方汉化版、绿色版、网盘版——这是供应链攻击的常见入口。
3. **核对哈希**：Releases 页面每个产物都有 `.sha256`，下载完用 `Get-FileHash` 校验。Clash Party 还有 GPG 签名，导入 key 后可 `gpg --verify`。
4. **mihomo / sing-box 内核默认只听本机 API**：`external-controller: 127.0.0.1:9090`，只要不手动改成 `0.0.0.0`，就不会被外部利用 [mihomo 历史的 external-ui 路径越权漏洞](https://socket.dev/go/package/github.com/metacubex/mihomo)。
5. **代理客户端不要用 Administrator 账户日常运行**：TUN 启动会跳 UAC 是正确行为；你日常 Windows 账户应当是普通用户，UAC 弹了再确认即可。

##### 哪些信号值得警惕（任何代理软件都适用）

- 🚩 **维护者不回应安全 issue**（v2rayN #4832 是典型反例）
- 🚩 **release 页面打包未签名 + 无 checksum**
- 🚩 **二进制和 GitHub Actions build log 对不上**（无法溯源）
- 🚩 **强行让你"关掉杀毒软件"才能装**
- 🚩 **第三方修改版 / "破解汉化版"**（这种是高危区，远离）

##### 综合（UX × 协议 × 安全）三因素的最终推荐

按你的全部诉求重排：

1. 🥇 **Clash Verge Rev** — Tauri+Rust 攻击面最小、社区最大、三协议全 + Surge-style 规则 + TUN 启动稳定。**安全和体验双优**。
2. 🥈 **Clash Party**（原 Mihomo Party）— 跟 Clash Verge Rev 内核相同，UX 略胜（Electron 启动快、TUN 体验略顺），但 Electron 攻击面比 Tauri 大；GPG 签名是加分项。和 Verge Rev 二选一看个人审美。
3. 🥉 **sing-box-windows** — 单维护者是单点风险；只有当你必须用 sing-box 独家协议特性时再上。
4. ❌ **v2rayN** — TUN 持久化未解决 + #4832 安全 issue 维护者不回应 + Xray JSON 规则啰嗦。**不建议继续用**。

> 💡 **如果你有偏执级安全需求**，优先选 Clash Verge Rev：Tauri 的 WebView 沙箱比 Electron 更严格，Rust 内存安全比 C# 强。两个 mihomo 内核客户端协议覆盖完全相同，换个 GUI 而已，无功能损失。

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
