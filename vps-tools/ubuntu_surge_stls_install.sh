#!/usr/bin/env bash
set -euo pipefail

# ================== 仅 Ubuntu 24.04 ==================
if [[ "$(lsb_release -rs 2>/dev/null || true)" != "24.04" ]]; then
  echo "本脚本仅支持 Ubuntu 24.04。当前系统：$(lsb_release -ds 2>/dev/null || echo '未知')"
  exit 1
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash $(basename "$0")"
  exit 1
fi

# ================== 可改参数（尽量少） ==================
STLS_PORT="${STLS_PORT:-443}"                 # ShadowTLS 对外端口（建议 443）
TLS_DOMAIN="${TLS_DOMAIN:-www.cloudflare.com}" # 伪装域名（无需你拥有）
TLS_TARGET_PORT="${TLS_TARGET_PORT:-443}"      # 伪装目标端口（通常固定 443）
BACKEND_PORT="${BACKEND_PORT:-$(shuf -i 20000-60000 -n 1)}"  # Snell 本地端口

# ================== 小工具函数 ==================
rand_token() { openssl rand -base64 32 | tr -d '=' | tr '+/' '-_' | tr -d '\n'; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令：$1"; exit 1; }; }
check_port() {
  # 使用更精确的正则匹配，确保端口号前后有边界
  if ss -tuln 2>/dev/null | grep -qE ":(${1})\s"; then
    echo "端口 $1 已被占用，请更换端口或停止占用进程"
    exit 1
  fi
}

echo "【1/5】安装依赖（curl/jq/unzip/openssl/file）..."
apt-get update -y >/dev/null
apt-get install -y curl jq unzip openssl ca-certificates file >/dev/null

need_cmd curl; need_cmd jq; need_cmd unzip; need_cmd openssl; need_cmd file

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) SNELL_ARCH="amd64"; STLS_ARCH="amd64" ;;
  aarch64|arm64) SNELL_ARCH="aarch64"; STLS_ARCH="aarch64" ;;
  *) echo "不支持的架构：$ARCH（仅支持 x86_64/arm64）"; exit 1 ;;
esac

# 检查端口是否可用
check_port "$STLS_PORT"
check_port "$BACKEND_PORT"

echo "【2/5】获取并安装 Snell v5（从 Surge 官方下载站）..."
if [[ -z "${SNELL_VER:-}" ]]; then
  # 从 Surge KB 页面里"抓取" snell-server v5 最新版本号（尽量简化实现）
  SNELL_KB_URL="https://kb.nssurge.com/surge-knowledge-base/release-notes/snell"
  SNELL_VER="$(
    curl -fsSL "$SNELL_KB_URL" \
    | grep -oE 'snell-server-v5\.[0-9]+\.[0-9]+[^-]*-linux' \
    | head -n1 \
    | sed -E 's/snell-server-(v5\.[0-9]+\.[0-9]+[^-]*)-linux/\1/'
  )"
  if [[ -z "${SNELL_VER:-}" ]]; then
    echo "无法从 Surge KB 自动识别 Snell v5 版本号。你可以稍后手动指定 SNELL_VER 再运行。"
    echo "例如：SNELL_VER=v5.0.1 sudo bash $(basename "$0")"
    exit 1
  fi
  echo "自动识别到 Snell 版本: ${SNELL_VER}"
else
  echo "使用用户指定的 Snell 版本: ${SNELL_VER}"
fi

SNELL_URL="https://dl.nssurge.com/snell/snell-server-${SNELL_VER}-linux-${SNELL_ARCH}.zip"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
curl -fsSL "$SNELL_URL" -o "$TMPDIR/snell.zip"
unzip -q -o "$TMPDIR/snell.zip" -d "$TMPDIR"
install -m 0755 "$TMPDIR/snell-server" /usr/local/bin/snell-server
trap - EXIT
rm -rf "$TMPDIR"

echo "【3/5】获取并安装 ShadowTLS（GitHub 最新版）..."
STLS_API="https://api.github.com/repos/ihciah/shadow-tls/releases/latest"

# 针对 x86_64 架构，匹配 x86_64 或 amd64；针对 aarch64 架构，匹配 aarch64
if [[ "$STLS_ARCH" == "amd64" ]]; then
  STLS_PATTERN="x86_64|amd64"
else
  STLS_PATTERN="$STLS_ARCH"
fi

STLS_URL="$(
  curl -fsSL "$STLS_API" \
  | jq -r --arg p "$STLS_PATTERN" '.assets[] | select(.name|test("linux") and test($p)) | .browser_download_url' \
  | head -n1
)"
if [[ -z "${STLS_URL:-}" || "${STLS_URL}" == "null" ]]; then
  echo "❌ 无法自动找到 ShadowTLS 的 linux(${STLS_ARCH}) 安装包。"
  echo "可用的 Linux 文件："
  curl -fsSL "$STLS_API" | jq -r '.assets[].name' | grep -i linux || true
  echo ""
  echo "请手动查看 release assets：https://github.com/ihciah/shadow-tls/releases/latest"
  exit 1
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
curl -fsSL "$STLS_URL" -o "$TMPDIR/stls.pkg"

# 检查文件类型并处理（支持 gzip/zip/直接可执行文件）
FILE_TYPE="$(file "$TMPDIR/stls.pkg")"
if echo "$FILE_TYPE" | grep -qi 'gzip'; then
  # tar.gz 压缩包
  tar -xzf "$TMPDIR/stls.pkg" -C "$TMPDIR"
  STLS_BIN="$(find "$TMPDIR" -maxdepth 3 -type f -executable -name 'shadow-tls*' | head -n1 || true)"
elif echo "$FILE_TYPE" | grep -qi 'zip'; then
  # zip 压缩包
  unzip -q -o "$TMPDIR/stls.pkg" -d "$TMPDIR"
  STLS_BIN="$(find "$TMPDIR" -maxdepth 3 -type f -executable -name 'shadow-tls*' | head -n1 || true)"
elif echo "$FILE_TYPE" | grep -qi 'executable'; then
  # 直接的可执行文件，不需要解压
  STLS_BIN="$TMPDIR/stls.pkg"
else
  echo "❌ 未知的文件格式："
  echo "$FILE_TYPE"
  exit 1
fi

if [[ -z "${STLS_BIN:-}" ]]; then
  echo "❌ ShadowTLS 二进制未找到（解包结果异常）。"
  exit 1
fi
install -m 0755 "$STLS_BIN" /usr/local/bin/shadow-tls
trap - EXIT
rm -rf "$TMPDIR"

echo "【4/5】写入配置（Snell 本地监听 + ShadowTLS 外层伪装）..."
SNELL_PSK="$(rand_token)"
STLS_PWD="$(rand_token)"

mkdir -p /etc/snell /etc/shadowtls

cat > /etc/snell/snell.conf <<EOF
listen = 127.0.0.1:${BACKEND_PORT}
psk = ${SNELL_PSK}
reuse = true
ipv6 = false
EOF

cat > /etc/shadowtls/env <<EOF
MODE=server
LISTEN=0.0.0.0:${STLS_PORT}
SERVER=127.0.0.1:${BACKEND_PORT}
TLS=${TLS_DOMAIN}:${TLS_TARGET_PORT}
PASSWORD=${STLS_PWD}
EOF

chmod 600 /etc/snell/snell.conf /etc/shadowtls/env

cat > /etc/systemd/system/snell.service <<'EOF'
[Unit]
Description=Snell Server (v5)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/snell-server -c /etc/snell/snell.conf
Restart=on-failure
RestartSec=1
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/snell

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/shadowtls.service <<'EOF'
[Unit]
Description=ShadowTLS v3 (server)
After=network-online.target snell.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/shadowtls/env
ExecStart=/usr/local/bin/shadow-tls
Restart=on-failure
RestartSec=1
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/shadowtls

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now snell.service shadowtls.service

# 等待服务启动并验证状态
sleep 2
if ! systemctl is-active --quiet snell.service; then
  echo "❌ Snell 服务启动失败，查看日志："
  journalctl -u snell.service -n 20 --no-pager
  exit 1
fi
if ! systemctl is-active --quiet shadowtls.service; then
  echo "❌ ShadowTLS 服务启动失败，查看日志："
  journalctl -u shadowtls.service -n 20 --no-pager
  exit 1
fi

echo "【5/5】完成 ✅"
echo
echo "========== Surge 配置信息 =========="
echo "服务器IP: <你的服务器IP>"
echo "端口: ${STLS_PORT}"
echo "PSK: ${SNELL_PSK}"
echo "ShadowTLS密码: ${STLS_PWD}"
echo "SNI: ${TLS_DOMAIN}"
echo ""
echo "========== 完整配置（复制下面整行到Surge）=========="
echo "Snell-STLS = snell, <你的服务器IP>, ${STLS_PORT}, psk=${SNELL_PSK}, version=5, reuse=true, shadow-tls-password=${STLS_PWD}, shadow-tls-version=3, shadow-tls-sni=${TLS_DOMAIN}"
echo "=========================================="
echo
echo "服务状态："
systemctl --no-pager --full status snell.service shadowtls.service | head -n 30 || true
echo
echo "提示：请确保安全组/防火墙放行 TCP/${STLS_PORT}（通常 443）。"