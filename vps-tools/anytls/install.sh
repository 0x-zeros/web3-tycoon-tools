#!/usr/bin/env bash
# ============================================================
# 工具：AnyTLS（sing-box）一键部署（Ubuntu 24.04）
# 维护：vps-tools
# ============================================================
#
# 用途
#   在干净的 Ubuntu 24.04 VPS 上部署 sing-box 服务端，开启 AnyTLS inbound。
#   AnyTLS 是 sing-box 2025-03 引入的代理协议，特点：
#     - 自带 TLS 伪装层（不像旧 ShadowTLS 借别人的握手）
#     - 自带认证（password）+ 数据通道，不需要再叠 SS/Snell 后端
#     - 内置 padding 方案，专门减弱"TLS 代理"流量特征
#     - 是 ShadowTLS v3（已被 Aparecium 识别）的事实下一代替代方案
#   服务以专用系统用户 sing-box 降权运行，不以 root 跑。
#
# 前置条件
#   - 仅支持 Ubuntu 24.04
#   - 必须 root 运行（sudo bash install.sh）
#   - 已放行 TCP/${LISTEN_PORT}（默认 443）
#   - 网络可访问 api.github.com 和 github.com release CDN
#   - Surge 客户端版本：iOS 5.17.0+ 或 Mac 6.4.3+（更早版本不支持 AnyTLS）
#
# 用法
#   sudo bash install.sh                                      # 默认：自签证书 + 443 + cloudflare SNI
#   sudo LISTEN_PORT=8443 bash install.sh                     # 改端口（建议保持 443 或常见 alt-HTTPS 端口）
#   sudo SNI=www.microsoft.com bash install.sh                # 换伪装 SNI
#   sudo DOMAIN=my.example.com EMAIL=me@x.com bash install.sh # 启用 ACME 真实证书（需要域名解析到本机）
#
# 可调环境变量
#   LISTEN_PORT       默认 443                  AnyTLS 对外端口（标准 HTTPS 端口最隐蔽）
#   SNI               默认 www.cloudflare.com   伪装 SNI；自签证书时用作 CN
#   DOMAIN            默认 空                   提供则启用 ACME 真实证书；不提供走自签
#   EMAIL             默认 空                   ACME 注册邮箱（DOMAIN 提供时必填）
#   SINGBOX_VER       默认 自动从 GitHub release latest 抓
#   ALLOW_ACME_NON_443 默认 0                   ACME + 非 443 时设为 1 才允许继续
#
# 输出
#   终端打印：服务器（IP 或 DOMAIN）、端口、密码、SNI、完整 Surge 配置行。
#
# 卸载
#   sudo bash uninstall.sh
#
# 关于自签证书
#   默认走自签证书是为了"无域名也能跑"。代价是客户端要 skip-cert-verify=true。
#   AnyTLS 的抗探测来自 padding 方案而非证书合法性，自签不影响伪装效果。
#   如果你有域名，提供 DOMAIN + EMAIL 启用 ACME 拿真证书更干净，且不需要 skip-cert-verify。
# ============================================================

set -euo pipefail

# ---- 步骤 0: 守卫 root + Ubuntu 24.04 ----
if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash $(basename "$0")"
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "无法读取 /etc/os-release，本脚本仅支持 Ubuntu 24.04"
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "本脚本仅支持 Ubuntu 24.04。当前系统：${PRETTY_NAME:-未知}"
  exit 1
fi

# ---- 步骤 1: 解析参数 ----
LISTEN_PORT="${LISTEN_PORT:-443}"
SNI="${SNI:-www.cloudflare.com}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
SINGBOX_VER="${SINGBOX_VER:-}"
ALLOW_ACME_NON_443="${ALLOW_ACME_NON_443:-0}"

# ---- 步骤 1.5: 校验参数格式 ----
validate_port() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "❌ ${name} 必须是 1-65535 的整数，当前值：${value}"
    exit 1
  fi
  local n=$((10#$value))
  if (( n < 1 || n > 65535 )); then
    echo "❌ ${name} 必须是 1-65535 的整数，当前值：${value}"
    exit 1
  fi
}

validate_hostname() {
  local name="$1"
  local value="$2"
  if [[ ${#value} -gt 253 || ! "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$ ]]; then
    echo "❌ ${name} 必须是合法主机名，当前值：${value}"
    exit 1
  fi
}

validate_email() {
  local value="$1"
  if [[ ! "$value" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]]; then
    echo "❌ EMAIL 格式不合法：${value}"
    exit 1
  fi
}

validate_singbox_version() {
  local value="$1"
  if [[ -n "$value" && ! "$value" =~ ^v?[0-9]+(\.[0-9]+){1,3}([-+._A-Za-z0-9]+)?$ ]]; then
    echo "❌ SINGBOX_VER 格式不合法：${value}"
    exit 1
  fi
}

validate_port "LISTEN_PORT" "$LISTEN_PORT"
validate_hostname "SNI" "$SNI"
validate_singbox_version "$SINGBOX_VER"
if [[ -n "$DOMAIN" ]]; then
  validate_hostname "DOMAIN" "$DOMAIN"
fi
if [[ -n "$EMAIL" ]]; then
  validate_email "$EMAIL"
fi
if [[ "$ALLOW_ACME_NON_443" != "0" && "$ALLOW_ACME_NON_443" != "1" ]]; then
  echo "❌ ALLOW_ACME_NON_443 只能是 0 或 1，当前值：${ALLOW_ACME_NON_443}"
  exit 1
fi

# ACME 模式必须有 EMAIL
if [[ -n "$DOMAIN" && -z "$EMAIL" ]]; then
  echo "❌ 启用 ACME（提供了 DOMAIN）就必须同时提供 EMAIL"
  echo "   示例：sudo DOMAIN=my.example.com EMAIL=me@x.com bash $(basename "$0")"
  exit 1
fi

# ACME 模式 + 非 443：大多数证书签发流程要求标准端口可达。
# 非交互环境里不使用 read 提示，避免 CI/远程批处理卡住或意外退出。
if [[ -n "$DOMAIN" && "$LISTEN_PORT" != "443" && "$ALLOW_ACME_NON_443" != "1" ]]; then
  echo "❌ 启用了 ACME 但 LISTEN_PORT=${LISTEN_PORT}（非 443）"
  echo "   请改用 LISTEN_PORT=443，或确认签发链路可用后显式设置 ALLOW_ACME_NON_443=1"
  exit 1
fi

# ---- 工具函数 ----
rand_token() {
  # 与 Snell/STLS 一致的 URL-safe base64，避免 +/= 出现在 Surge password=... 字段里
  openssl rand -base64 48 | tr -d '=' | tr '+/' '-_' | tr -d '\n'
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "缺少命令：$1"; exit 1; }
}

ensure_ss_available() {
  if ! command -v ss >/dev/null 2>&1; then
    echo "检测到缺少 ss，正在安装 iproute2..."
    apt-get update -y >/dev/null
    apt-get install -y iproute2 >/dev/null
  fi
}

check_port() {
  if ss -H -ltn 2>/dev/null | grep -qE ":${1}\b"; then
    echo "端口 $1 已被占用，请更换端口或停止占用该端口的进程"
    exit 1
  fi
}

detect_public_ip() {
  local ip
  for src in "https://api.ipify.org" "https://ifconfig.me" "https://ipinfo.io/ip"; do
    ip="$(curl -fsSL --max-time 5 "$src" 2>/dev/null || true)"
    if [[ -n "$ip" && "$ip" =~ [.:] ]]; then
      echo "$ip"
      return 0
    fi
  done
  echo "<你的服务器IP>"
}

# ---- 步骤 2: 端口占用检查 ----
ensure_ss_available
check_port "$LISTEN_PORT"

# ---- 步骤 3: 安装依赖 ----
echo "【1/7】安装依赖（curl/jq/openssl/tar/iproute2）..."
apt-get update -y >/dev/null
apt-get install -y curl jq openssl ca-certificates tar iproute2 >/dev/null

need_cmd curl
need_cmd jq
need_cmd openssl
need_cmd tar
need_cmd ss

# ---- 步骤 4: 识别 CPU 架构 ----
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)   SB_ARCH="amd64" ;;
  aarch64|arm64)  SB_ARCH="arm64" ;;
  *) echo "不支持的架构：$ARCH（仅 x86_64 / arm64）"; exit 1 ;;
esac

# ---- 步骤 5: 创建专用系统用户 sing-box ----
echo "【2/7】创建专用系统用户 sing-box（如不存在）..."
if ! id sing-box &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin --user-group sing-box
fi

# ---- 步骤 6: 拉取 sing-box 二进制 ----
echo "【3/7】拉取 sing-box 最新版..."
SB_API="https://api.github.com/repos/SagerNet/sing-box/releases/latest"

if [[ -z "$SINGBOX_VER" ]]; then
  # tag_name 形如 "v1.13.0"，下载文件用的是 "1.13.0"（不带 v）
  SINGBOX_TAG="$(curl -fsSL --max-time 10 "$SB_API" | jq -r '.tag_name')"
  if [[ -z "$SINGBOX_TAG" || "$SINGBOX_TAG" == "null" ]]; then
    echo "❌ 无法从 GitHub 获取 sing-box 最新版本号"
    exit 1
  fi
  SINGBOX_VER="${SINGBOX_TAG#v}"
  echo "自动识别到 sing-box 版本：${SINGBOX_TAG}"
else
  SINGBOX_TAG="v${SINGBOX_VER#v}"   # 容忍用户传 1.13.0 或 v1.13.0
  SINGBOX_VER="${SINGBOX_VER#v}"
  echo "使用用户指定的 sing-box 版本：${SINGBOX_TAG}"
fi

SB_PKG="sing-box-${SINGBOX_VER}-linux-${SB_ARCH}.tar.gz"
SB_URL="https://github.com/SagerNet/sing-box/releases/download/${SINGBOX_TAG}/${SB_PKG}"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL --max-time 120 "$SB_URL" -o "$TMPDIR/sb.tar.gz"
tar -xzf "$TMPDIR/sb.tar.gz" -C "$TMPDIR"

# 解压后的目录是 sing-box-1.x.y-linux-amd64/，里面有 sing-box 二进制
SB_BIN="$(find "$TMPDIR" -maxdepth 3 -type f -name 'sing-box' | head -n1 || true)"
if [[ -z "$SB_BIN" ]]; then
  echo "❌ sing-box 二进制未在解压结果中找到"
  exit 1
fi
install -m 0755 "$SB_BIN" /usr/local/bin/sing-box

rm -rf "$TMPDIR"
trap - EXIT

# ---- 步骤 7: 准备配置目录 ----
mkdir -p /etc/sing-box
chown sing-box:sing-box /etc/sing-box
chmod 750 /etc/sing-box

# ---- 步骤 8: 生成强随机密码 ----
echo "【4/7】生成 AnyTLS 密码..."
PASSWORD="$(rand_token)"

# ---- 步骤 9: 准备证书 ----
echo "【5/7】准备 TLS 证书..."
if [[ -z "$DOMAIN" ]]; then
  # 自签：ECDSA P-256 比 RSA 更小更快；10 年有效期避免到期重装
  # CN 用 SNI，避免客户端 SNI 与证书 CN 完全错位被某些校验链路打断
  # 用两步 ecparam + req 比 `req -newkey ec -pkeyopt` 更兼容（后者在不同 OpenSSL 版本
  # req 子命令的 -newkey 实现里行为不一致）
  echo "  → 模式：自签证书（CN=${SNI}）"
  openssl ecparam -name prime256v1 -genkey -noout -out /etc/sing-box/key.pem
  openssl req -x509 -nodes -days 3650 \
    -key /etc/sing-box/key.pem \
    -out /etc/sing-box/cert.pem \
    -subj "/CN=${SNI}" >/dev/null 2>&1
  chown sing-box:sing-box /etc/sing-box/cert.pem /etc/sing-box/key.pem
  chmod 640 /etc/sing-box/cert.pem /etc/sing-box/key.pem
  CERT_SERVER_NAME="$SNI"
else
  echo "  → 模式：ACME（DOMAIN=${DOMAIN}）"
  CERT_SERVER_NAME="$DOMAIN"
  # ACME 证书让 sing-box 自己管，写到 /etc/sing-box/acme/，sing-box 启动时自动续期
fi

# ---- 步骤 10: 写 sing-box 配置 ----
# AnyTLS inbound：
#   - users[].name 给个固定 "default"，因为本版不做多用户
#   - padding_scheme 用 sing-box 官方文档的推荐值，作用是让分组长度不再有"代理流量"特征
#   - tls.enabled 必须 true（AnyTLS 必须有 TLS 层）
# outbounds 只留一个 direct，因为这台机器只做"代理出口"，不做链式转发
echo "【6/7】写 sing-box 配置..."
if [[ -z "$DOMAIN" ]]; then
  # 自签证书分支：tls 引用本地 cert/key
  cat > /etc/sing-box/config.json <<EOF
{
  "log": {
    "level": "info",
    "timestamp": true
  },
  "inbounds": [
    {
      "type": "anytls",
      "tag": "anytls-in",
      "listen": "::",
      "listen_port": ${LISTEN_PORT},
      "users": [
        {
          "name": "default",
          "password": "${PASSWORD}"
        }
      ],
      "padding_scheme": [
        "stop=8",
        "0=30-30",
        "1=100-400",
        "2=400-500",
        "3=500-1000",
        "4=500-1000",
        "5=500-1000",
        "6=500-1000",
        "7=500-1000"
      ],
      "tls": {
        "enabled": true,
        "server_name": "${CERT_SERVER_NAME}",
        "certificate_path": "/etc/sing-box/cert.pem",
        "key_path": "/etc/sing-box/key.pem"
      }
    }
  ],
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    }
  ]
}
EOF
else
  # ACME 分支：tls.acme 让 sing-box 自动签和续期；不要 certificate_path/key_path
  cat > /etc/sing-box/config.json <<EOF
{
  "log": {
    "level": "info",
    "timestamp": true
  },
  "inbounds": [
    {
      "type": "anytls",
      "tag": "anytls-in",
      "listen": "::",
      "listen_port": ${LISTEN_PORT},
      "users": [
        {
          "name": "default",
          "password": "${PASSWORD}"
        }
      ],
      "padding_scheme": [
        "stop=8",
        "0=30-30",
        "1=100-400",
        "2=400-500",
        "3=500-1000",
        "4=500-1000",
        "5=500-1000",
        "6=500-1000",
        "7=500-1000"
      ],
      "tls": {
        "enabled": true,
        "server_name": "${CERT_SERVER_NAME}",
        "acme": {
          "domain": ["${DOMAIN}"],
          "email": "${EMAIL}",
          "data_directory": "/etc/sing-box/acme"
        }
      }
    }
  ],
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    }
  ]
}
EOF
fi

chown sing-box:sing-box /etc/sing-box/config.json
chmod 640 /etc/sing-box/config.json

# ---- 步骤 11: 写 systemd unit ----
# - User=sing-box 让进程降权
# - AmbientCapabilities=CAP_NET_BIND_SERVICE 让非 root 进程能 bind 443
#   （即使端口 > 1024 也保留，方便用户随手改成 443/80 不用再改 unit）
# - ReadWritePaths=/etc/sing-box 配合 ProtectSystem=strict 给 ACME 写证书的权限
cat > /etc/systemd/system/sing-box.service <<'EOF'
[Unit]
Description=sing-box (AnyTLS server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=sing-box
Group=sing-box
ExecStart=/usr/local/bin/sing-box run -c /etc/sing-box/config.json
Restart=on-failure
RestartSec=1
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/sing-box
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

# ---- 步骤 12: 启动并校验 ----
echo "【7/7】启动并校验服务..."
systemctl daemon-reload
systemctl enable --now sing-box.service

sleep 2

if ! systemctl is-active --quiet sing-box.service; then
  echo "❌ sing-box.service 启动失败，最近日志："
  journalctl -u sing-box.service -n 40 --no-pager
  exit 1
fi

if ! ss -tlnp 2>/dev/null | grep -qE ":${LISTEN_PORT}\b"; then
  echo "❌ AnyTLS 端口 ${LISTEN_PORT} 未在监听，当前 LISTEN 列表："
  ss -tlnp || true
  echo
  echo "sing-box 服务日志："
  journalctl -u sing-box.service -n 40 --no-pager
  exit 1
fi

# ---- 步骤 13: 探测公网 IP / 决定显示用的 host ----
PUBLIC_IP="$(detect_public_ip)"
if [[ -n "$DOMAIN" ]]; then
  DISPLAY_HOST="$DOMAIN"
else
  DISPLAY_HOST="$PUBLIC_IP"
fi

# ---- 步骤 14: 输出 Surge 配置 ----
echo
echo "========== 部署成功 ✅ =========="
echo "服务器           : ${DISPLAY_HOST}"
echo "端口             : ${LISTEN_PORT}"
echo "密码             : ${PASSWORD}"
echo "SNI              : ${CERT_SERVER_NAME}"
echo "证书模式         : $([[ -z "$DOMAIN" ]] && echo "自签 (skip-cert-verify=true)" || echo "ACME (真实证书)")"
echo
echo "========== Surge 配置（复制下面整行）=========="
if [[ -z "$DOMAIN" ]]; then
  echo "AnyTLS = anytls, ${DISPLAY_HOST}, ${LISTEN_PORT}, password=${PASSWORD}, sni=${CERT_SERVER_NAME}, skip-cert-verify=true"
else
  echo "AnyTLS = anytls, ${DISPLAY_HOST}, ${LISTEN_PORT}, password=${PASSWORD}, sni=${CERT_SERVER_NAME}"
fi
echo "================================================"
echo
echo "服务状态："
systemctl --no-pager --full status sing-box.service | head -n 30 || true
echo
echo "📌 防火墙：请确保安全组/系统防火墙放行 TCP/${LISTEN_PORT}"
echo "📌 凭据保存位置：/etc/sing-box/config.json （权限 640）"
echo "📌 事后再看 / 打印二维码（扫码导入到 Shadowrocket / Clash Verge Rev 等）："
echo "    sudo bash print-qr.sh"
if [[ -z "$DOMAIN" ]]; then
  echo
  echo "ℹ️  当前为自签证书模式，Surge 客户端必须勾选 skip-cert-verify"
  echo "   想换成真实证书：删除自签 → sudo bash uninstall.sh → sudo DOMAIN=... EMAIL=... bash install.sh"
fi
echo
echo "ℹ️  Surge 客户端版本要求：iOS 5.17.0+ 或 Mac 6.4.3+"
