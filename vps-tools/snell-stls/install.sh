#!/usr/bin/env bash
# ============================================================
# 工具：Snell v5 + ShadowTLS v3 一键部署（Ubuntu 24.04）
# 维护：vps-tools
# ============================================================
#
# 用途
#   在干净的 Ubuntu 24.04 VPS 上部署：
#     - Snell v5 服务（仅监听 127.0.0.1，承担真正的代理逻辑）
#     - ShadowTLS v3 服务（监听公网端口，把流量伪装成 TLS 1.3 握手）
#   两个服务都以专用系统用户 snell 降权运行，不以 root 跑。
#
# 前置条件
#   - 仅支持 Ubuntu 24.04（其他发行版会主动退出）
#   - 必须 root 运行（sudo bash install.sh）
#   - 已放行 TCP/${STLS_PORT}（云厂商安全组 + 系统防火墙都要放）
#   - 网络可访问 dl.nssurge.com 和 api.github.com
#
# 用法
#   sudo bash install.sh                                  # 全默认（STLS 监听 8443）
#   sudo STLS_PORT=443 bash install.sh                    # 改用 443（更隐蔽，但常被云厂商默认放行）
#   sudo TLS_DOMAIN=www.microsoft.com bash install.sh     # 换伪装 SNI
#   sudo SNELL_VER=v5.0.1 bash install.sh                 # 锁 Snell 版本（避免上游 KB 改版）
#
# 可调环境变量
#   STLS_PORT         默认 8443      ShadowTLS 对外端口
#   TLS_DOMAIN        默认 www.cloudflare.com  伪装 SNI（无需你拥有）
#   TLS_TARGET_PORT   默认 443       伪装站点端口（通常固定 443）
#   BACKEND_PORT      默认 8388      Snell 本地端口（仅 127.0.0.1）
#   SNELL_VER         默认 自动从 Surge KB 抓取，失败兜底 v5.0.1
#
# 输出
#   终端打印：服务器公网 IP（自动探测）、Snell PSK、ShadowTLS 密码、
#             完整可复制的 Surge 配置行，以及 systemd 服务状态前 30 行。
#
# 卸载
#   sudo bash uninstall.sh
#
# 安全提示
#   ShadowTLS v3 在 2025-06 之后已被 Aparecium 工具识别（ServerFinished
#   长度差指纹）。强审查环境建议改用 AnyTLS（见 ../anytls/）。
# ============================================================

set -euo pipefail

# ---- 步骤 0: 守卫 root + Ubuntu 24.04 ----
# 这两个守卫必须放在最前。脚本会写 /etc 和 systemd，没 root 不可能成功；
# 跨发行版的 apt-get/服务管理都不一样，不在第一版兼容范围内。
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

# ---- 步骤 1: 解析可调参数 ----
STLS_PORT="${STLS_PORT:-8443}"
TLS_DOMAIN="${TLS_DOMAIN:-www.cloudflare.com}"
TLS_TARGET_PORT="${TLS_TARGET_PORT:-443}"
BACKEND_PORT="${BACKEND_PORT:-8388}"
# SNELL_VER 留空表示走自动抓取流程；不在这里设默认，让步骤 6 决定兜底
SNELL_VER="${SNELL_VER:-}"

# 兜底版本号：Surge KB 页面结构变化时使用
SNELL_FALLBACK_VER="v5.0.1"

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

validate_snell_version() {
  local value="$1"
  if [[ -n "$value" && ! "$value" =~ ^v?5(\.[0-9]+){2}([-+._A-Za-z0-9]+)?$ ]]; then
    echo "❌ SNELL_VER 格式不合法：${value}"
    exit 1
  fi
}

validate_port "STLS_PORT" "$STLS_PORT"
validate_port "TLS_TARGET_PORT" "$TLS_TARGET_PORT"
validate_port "BACKEND_PORT" "$BACKEND_PORT"
validate_hostname "TLS_DOMAIN" "$TLS_DOMAIN"
validate_snell_version "$SNELL_VER"

# ---- 工具函数 ----
# rand_token: 生成 URL-safe 强随机串
#   - 48 字节熵 ≈ 384-bit，远超实际安全边界
#   - 转 URL-safe（去掉 '='/'+'/'/'）让它能直接放进 Surge 配置的 key=value
rand_token() {
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

# check_port: 检查 TCP 端口未被占用
#   - ss 输出格式为 "LISTEN ... :PORT ..."，用 \b 边界避免 8443 误命中 84430
check_port() {
  if ss -H -ltn 2>/dev/null | grep -qE ":${1}\b"; then
    echo "端口 $1 已被占用，请更换端口或停止占用该端口的进程"
    exit 1
  fi
}

# detect_public_ip: 多源探测公网 IP，全部失败回退占位
#   - 三个源都用短超时（5 秒），避免在网络异常时让脚本卡死
detect_public_ip() {
  local ip
  for src in "https://api.ipify.org" "https://ifconfig.me" "https://ipinfo.io/ip"; do
    ip="$(curl -fsSL --max-time 5 "$src" 2>/dev/null || true)"
    # 简单校验：包含点或冒号（IPv4/IPv6 都接受）
    if [[ -n "$ip" && "$ip" =~ [.:] ]]; then
      echo "$ip"
      return 0
    fi
  done
  echo "<你的服务器IP>"
}

# ---- 步骤 2: 端口占用检查 ----
ensure_ss_available
check_port "$STLS_PORT"
check_port "$BACKEND_PORT"

# ---- 步骤 3: 安装依赖 ----
# file 用来识别 ShadowTLS 下载产物的格式（zip / tar.gz / 裸 ELF），不能省
echo "【1/7】安装依赖（curl/jq/unzip/openssl/file/tar/iproute2）..."
apt-get update -y >/dev/null
apt-get install -y curl jq unzip openssl ca-certificates file tar iproute2 >/dev/null

need_cmd curl
need_cmd jq
need_cmd unzip
need_cmd openssl
need_cmd file
need_cmd tar
need_cmd ss

# ---- 步骤 4: 识别 CPU 架构 ----
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)   SNELL_ARCH="amd64";    STLS_ARCH="amd64"   ;;
  aarch64|arm64)  SNELL_ARCH="aarch64";  STLS_ARCH="aarch64" ;;
  *) echo "不支持的架构：$ARCH（仅 x86_64 / arm64）"; exit 1 ;;
esac

# ---- 步骤 5: 创建专用系统用户 snell ----
# 用 useradd 不是 adduser：useradd 是低层不交互工具，--system 不分配 UID 池里的普通 UID，
# --no-create-home 不建家目录，--shell /usr/sbin/nologin 禁止登录 shell，
# --user-group 同时建同名 group。已存在则跳过，保持脚本可重入。
echo "【2/7】创建专用系统用户 snell（如不存在）..."
if ! id snell &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin --user-group snell
fi

# ---- 步骤 6: 拉取 Snell v5 ----
echo "【3/7】拉取 Snell v5..."
if [[ -z "$SNELL_VER" ]]; then
  # Surge KB 没提供版本号 API，只能从 HTML 抓
  # 抓不到就走兜底，不让脚本失败——上游页面改版概率不低
  SNELL_KB_URL="https://kb.nssurge.com/surge-knowledge-base/release-notes/snell"
  SNELL_VER="$(
    curl -fsSL --max-time 10 "$SNELL_KB_URL" \
    | grep -oE 'snell-server-v5\.[0-9]+\.[0-9]+[^-]*-linux' \
    | head -n1 \
    | sed -E 's/snell-server-(v5\.[0-9]+\.[0-9]+[^-]*)-linux/\1/' \
    || true
  )"
  if [[ -z "$SNELL_VER" ]]; then
    echo "⚠️  无法从 Surge KB 自动识别 Snell v5 版本号，使用兜底版本 ${SNELL_FALLBACK_VER}"
    SNELL_VER="$SNELL_FALLBACK_VER"
  else
    echo "自动识别到 Snell 版本：${SNELL_VER}"
  fi
else
  SNELL_VER="v${SNELL_VER#v}"
  echo "使用用户指定的 Snell 版本：${SNELL_VER}"
fi

validate_snell_version "$SNELL_VER"
SNELL_URL="https://dl.nssurge.com/snell/snell-server-${SNELL_VER}-linux-${SNELL_ARCH}.zip"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
curl -fsSL --max-time 60 "$SNELL_URL" -o "$TMPDIR/snell.zip"
unzip -q -o "$TMPDIR/snell.zip" -d "$TMPDIR"
install -m 0755 "$TMPDIR/snell-server" /usr/local/bin/snell-server

# ---- 步骤 7: 拉取 ShadowTLS ----
echo "【4/7】拉取 ShadowTLS（GitHub latest release）..."
STLS_API="https://api.github.com/repos/ihciah/shadow-tls/releases/latest"

# 资源命名约定：amd64 在文件名里写作 x86_64 或 amd64，aarch64 就一个写法
if [[ "$STLS_ARCH" == "amd64" ]]; then
  STLS_PATTERN="x86_64|amd64"
else
  STLS_PATTERN="$STLS_ARCH"
fi

STLS_URL="$(
  curl -fsSL --max-time 10 "$STLS_API" \
  | jq -r --arg p "$STLS_PATTERN" \
      '.assets[] | select(.name|test("linux") and test($p)) | .browser_download_url' \
  | head -n1
)"

if [[ -z "${STLS_URL:-}" || "${STLS_URL}" == "null" ]]; then
  echo "❌ 无法找到 ShadowTLS 的 linux(${STLS_ARCH}) 安装包"
  echo "可用的 linux 文件："
  curl -fsSL --max-time 10 "$STLS_API" | jq -r '.assets[].name' | grep -i linux || true
  echo "请到 https://github.com/ihciah/shadow-tls/releases/latest 手动核对"
  exit 1
fi

# 重置 trap：旧 TMPDIR 已用完，新 TMPDIR 装 ShadowTLS
rm -rf "$TMPDIR"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL --max-time 60 "$STLS_URL" -o "$TMPDIR/stls.pkg"

# 上游 release 既出过 zip / tar.gz，又出过裸 ELF，必须按文件类型分流
FILE_TYPE="$(file "$TMPDIR/stls.pkg")"
if echo "$FILE_TYPE" | grep -qi 'gzip'; then
  tar -xzf "$TMPDIR/stls.pkg" -C "$TMPDIR"
  STLS_BIN="$(find "$TMPDIR" -maxdepth 3 -type f -executable -name 'shadow-tls*' | head -n1 || true)"
elif echo "$FILE_TYPE" | grep -qi 'zip'; then
  unzip -q -o "$TMPDIR/stls.pkg" -d "$TMPDIR"
  STLS_BIN="$(find "$TMPDIR" -maxdepth 3 -type f -executable -name 'shadow-tls*' | head -n1 || true)"
elif echo "$FILE_TYPE" | grep -qi 'executable'; then
  # 裸 ELF：直接用，不需要解包
  STLS_BIN="$TMPDIR/stls.pkg"
else
  echo "❌ ShadowTLS 下载产物未知格式：$FILE_TYPE"
  exit 1
fi

if [[ -z "${STLS_BIN:-}" ]]; then
  echo "❌ ShadowTLS 二进制未找到（解包结果异常）"
  exit 1
fi
install -m 0755 "$STLS_BIN" /usr/local/bin/shadow-tls

# 释放 trap，后续不再用临时目录
rm -rf "$TMPDIR"
trap - EXIT

# ---- 步骤 8: 生成强随机凭据 ----
echo "【5/7】生成 PSK 与 ShadowTLS 密码..."
SNELL_PSK="$(rand_token)"
STLS_PWD="$(rand_token)"

# ---- 步骤 9: 写配置文件 ----
echo "【6/7】写配置和 systemd unit..."
mkdir -p /etc/snell /etc/shadowtls

# Snell 配置：snell 用户自己读写
cat > /etc/snell/snell.conf <<EOF
[snell-server]
listen = 127.0.0.1:${BACKEND_PORT}
psk = ${SNELL_PSK}
reuse = true
ipv6 = false
EOF
chown snell:snell /etc/snell /etc/snell/snell.conf
chmod 700 /etc/snell
chmod 600 /etc/snell/snell.conf

# ShadowTLS 用 EnvironmentFile 存密码，避免明文写进 unit 文件。
# 注意：当前 shadow-tls CLI 仍要求通过 --password 传入密码，运行时 root 可从进程 argv 中看到；
# 这属于上游 CLI 限制。若后续上游支持 password-file/config，应优先改为文件读取。
# EnvironmentFile 由 systemd 启动前读取，服务进程不需要读取该文件。
cat > /etc/shadowtls/shadowtls.env <<EOF
LISTEN=0.0.0.0:${STLS_PORT}
SERVER=127.0.0.1:${BACKEND_PORT}
TLS=${TLS_DOMAIN}:${TLS_TARGET_PORT}
PASSWORD=${STLS_PWD}
EOF
chown root:root /etc/shadowtls /etc/shadowtls/shadowtls.env
chmod 750 /etc/shadowtls
chmod 600 /etc/shadowtls/shadowtls.env

# Snell systemd unit
# - User/Group=snell 让进程以 snell 跑而非 root
# - ReadWritePaths=/etc/snell 配合 ProtectSystem=strict 给 Snell 写权限
#   （Snell 本身不写文件，但保留以防未来需要）
cat > /etc/systemd/system/snell.service <<'EOF'
[Unit]
Description=Snell Server (v5)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=snell
Group=snell
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

# ShadowTLS systemd unit
# - EnvironmentFile 避免把密码明文写进 unit 文件；但 --password 仍会进入 shadow-tls 进程 argv
# - AmbientCapabilities=CAP_NET_BIND_SERVICE 即使默认 8443 不需要也保留，
#   方便用户随手把 STLS_PORT 改成 443/80 不用再改 unit
# - ProtectSystem=strict 不需要 ReadWritePaths，因为 ShadowTLS 不写文件
cat > /etc/systemd/system/shadowtls.service <<'EOF'
[Unit]
Description=ShadowTLS v3 (server)
After=network-online.target snell.service
Wants=network-online.target
Requires=snell.service

[Service]
Type=simple
User=snell
Group=snell
EnvironmentFile=/etc/shadowtls/shadowtls.env
ExecStart=/usr/local/bin/shadow-tls --v3 server --listen ${LISTEN} --server ${SERVER} --tls ${TLS} --password ${PASSWORD}
Restart=on-failure
RestartSec=1
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

# ---- 步骤 10: 启动服务 ----
echo "【7/7】启动并校验服务..."
systemctl daemon-reload
systemctl enable --now snell.service shadowtls.service

# 给服务 2 秒启动，避免立即 is-active 时还没 ready
sleep 2

# 第一道校验：systemd 认为它在跑
for svc in snell.service shadowtls.service; do
  if ! systemctl is-active --quiet "$svc"; then
    echo "❌ $svc 启动失败，最近日志："
    journalctl -u "$svc" -n 30 --no-pager
    exit 1
  fi
done

# 第二道校验：ShadowTLS 端口真的在监听
# is-active 通过不代表端口绑定成功（可能进程起来后立刻退出还在重启循环里）
if ! ss -tlnp 2>/dev/null | grep -qE ":${STLS_PORT}\b"; then
  echo "❌ ShadowTLS 端口 ${STLS_PORT} 未在监听，当前 LISTEN 列表："
  ss -tlnp || true
  echo
  echo "ShadowTLS 服务日志："
  journalctl -u shadowtls.service -n 30 --no-pager
  exit 1
fi

# ---- 步骤 11: 探测公网 IP ----
PUBLIC_IP="$(detect_public_ip)"

# ---- 步骤 12: 输出 Surge 配置 ----
echo
echo "========== 部署成功 ✅ =========="
echo "服务器 IP        : ${PUBLIC_IP}"
echo "ShadowTLS 端口   : ${STLS_PORT}"
echo "Snell PSK        : ${SNELL_PSK}"
echo "ShadowTLS 密码   : ${STLS_PWD}"
echo "伪装 SNI         : ${TLS_DOMAIN}"
echo
echo "========== Surge 配置（复制下面整行）=========="
echo "Snell-STLS = snell, ${PUBLIC_IP}, ${STLS_PORT}, psk=${SNELL_PSK}, version=5, reuse=true, shadow-tls-password=${STLS_PWD}, shadow-tls-version=3, shadow-tls-sni=${TLS_DOMAIN}"
echo "================================================"
echo
echo "服务状态："
systemctl --no-pager --full status snell.service shadowtls.service | head -n 30 || true
echo
echo "📌 防火墙：请确保安全组/系统防火墙放行 TCP/${STLS_PORT}"
echo "📌 凭据保存位置：/etc/snell/snell.conf  /etc/shadowtls/shadowtls.env （权限 600/600）"
echo "📌 事后再看（这套组合只 Surge 能用，二维码是 Surge 配置行的纯文本）："
echo "    curl -fsSL -o print-qr.sh https://raw.githubusercontent.com/0x-zeros/web3-tycoon-tools/main/vps-tools/snell-stls/print-qr.sh"
echo "    sudo bash print-qr.sh"
echo
echo "⚠️  ShadowTLS v3 在 2025-06 之后已被 Aparecium 工具识别（ServerFinished 长度差指纹）。"
echo "   强审查环境建议升级到 AnyTLS：见 ../anytls/ 同名 install.sh"
