# Snell v5 + ShadowTLS v3 一键部署

在干净的 Ubuntu 24.04 VPS 上一键部署 Snell v5（代理后端）+ ShadowTLS v3（TLS 伪装前端），两个服务都以专用系统用户 `snell` 降权运行。

## 前置条件

- **操作系统**：Ubuntu 24.04（其他发行版会被脚本主动拒绝）
- **权限**：root（用 `sudo`）
- **网络**：能访问 `dl.nssurge.com` 和 `api.github.com`
- **防火墙**：云厂商安全组 + 系统防火墙都要放行 TCP/`STLS_PORT`（默认 8443）

## Quickstart

```bash
# 1) 下载到 VPS
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

## 卸载

```bash
sudo bash uninstall.sh
```

会清理：systemd 服务、`/etc/snell`、`/etc/shadowtls`、`/usr/local/bin/{snell-server,shadow-tls}`、系统用户 `snell`。

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
