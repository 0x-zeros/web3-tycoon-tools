#!/usr/bin/env bash
# ============================================================
# 工具：Snell+ShadowTLS 配置查看 + 二维码打印（Ubuntu 24.04）
# 维护：vps-tools
# ============================================================
#
# 用途
#   读取已部署的 Snell + ShadowTLS 配置（/etc/snell/snell.conf +
#   /etc/shadowtls/shadowtls.env），重新打印：
#     - Surge 配置行（一行可粘贴，给 Surge 用）
#     - 终端 ANSI 二维码（内容是上面那行 Surge 配置的"纯文本"）
#   首次安装时这些信息已在 install.sh 末尾打过；此脚本是"事后再看"用的。
#
# ⚠️ 重要：Snell v5 + ShadowTLS v3 是 Surge 独家组合
#   - 跨客户端 URI 标准（snell:// / stls://）不存在
#   - 其它客户端（Shadowrocket / v2rayN / NekoBox 等）都用不了
#   因此本脚本生成的二维码 **只是把 Surge 配置行编码成 QR 文字**——
#   手机相机扫出来是一段纯文本，需要复制粘贴到 Surge 的 [Proxy] 段。
#   想要"真正能扫码导入"的方案，请改用同项目 ../anytls/。
#
# 前置条件
#   - 已运行过同目录 install.sh（存在 /etc/snell/snell.conf 和
#     /etc/shadowtls/shadowtls.env）
#   - 仅支持 Ubuntu 24.04
#   - 必须 root 运行（snell.conf 是 snell:snell 600，env 是 root:root 600）
#   - 若缺 qrencode 会自动 apt-get install
#
# 用法
#   sudo bash print-qr.sh               # 默认：打印 Surge 行 + 终端二维码
#   sudo bash print-qr.sh --no-qr       # 仅文字，不渲染二维码
#   sudo bash print-qr.sh --png FILE    # 同时把二维码保存到 PNG
#   sudo bash print-qr.sh --svg FILE    # 同时把二维码保存到 SVG（矢量）
#   sudo bash print-qr.sh --surge-only  # 只输出 Surge 配置一行（管道友好）
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
PNG_PATH=""
SVG_PATH=""
RENDER_QR=1
MODE="full"   # full | surge-only

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-qr)        RENDER_QR=0; shift ;;
    --png)          PNG_PATH="${2:-}"; [[ -z "$PNG_PATH" ]] && { echo "❌ --png 需要文件路径"; exit 1; }; shift 2 ;;
    --svg)          SVG_PATH="${2:-}"; [[ -z "$SVG_PATH" ]] && { echo "❌ --svg 需要文件路径"; exit 1; }; shift 2 ;;
    --surge-only)   MODE="surge-only"; RENDER_QR=0; shift ;;
    -h|--help)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *)
      echo "❌ 未知参数：$1（用 --help 看用法）"
      exit 1
      ;;
  esac
done

# ---- 步骤 2: 检查配置文件存在 ----
SNELL_CFG="/etc/snell/snell.conf"
STLS_ENV="/etc/shadowtls/shadowtls.env"
if [[ ! -r "$SNELL_CFG" || ! -r "$STLS_ENV" ]]; then
  echo "❌ 找不到配置文件："
  [[ ! -r "$SNELL_CFG" ]] && echo "   - ${SNELL_CFG}"
  [[ ! -r "$STLS_ENV"  ]] && echo "   - ${STLS_ENV}"
  echo "   请先运行：sudo bash install.sh"
  exit 1
fi

# ---- 步骤 3: 安装依赖 ----
need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_pkg() {
  local pkg="$1"
  local cmd="$2"
  if ! need_cmd "$cmd"; then
    echo "  缺少 ${cmd}，安装 ${pkg} ..." >&2
    apt-get update -y >/dev/null
    apt-get install -y "$pkg" >/dev/null
  fi
}

ensure_pkg curl curl

if [[ "$RENDER_QR" -eq 1 || -n "$PNG_PATH" || -n "$SVG_PATH" ]]; then
  ensure_pkg qrencode qrencode
fi

# ---- 工具函数 ----
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

# ---- 步骤 4: 读 Snell 配置 ----
# snell.conf 是 INI 风格：
#   [snell-server]
#   listen = 127.0.0.1:8388
#   psk = <token>
#   reuse = true
#   ipv6 = false
SNELL_PSK="$(awk -F'=' '/^[[:space:]]*psk[[:space:]]*=/ {sub(/^[[:space:]]+/, "", $2); sub(/[[:space:]]+$/, "", $2); print $2; exit}' "$SNELL_CFG")"
SNELL_LISTEN="$(awk -F'=' '/^[[:space:]]*listen[[:space:]]*=/ {sub(/^[[:space:]]+/, "", $2); sub(/[[:space:]]+$/, "", $2); print $2; exit}' "$SNELL_CFG")"
BACKEND_PORT="${SNELL_LISTEN##*:}"

# ---- 步骤 5: 读 ShadowTLS 配置 ----
# shadowtls.env 是 KEY=VALUE：
#   LISTEN=0.0.0.0:8443
#   SERVER=127.0.0.1:8388
#   TLS=www.cloudflare.com:443
#   PASSWORD=<token>
# 用 grep+cut 而不是 source 是因为这文件按 systemd EnvironmentFile 语义写的，
# 直接 source 在某些 shell 里对带特殊字符的 value 会出错
STLS_LISTEN="$(grep -E '^LISTEN='   "$STLS_ENV" | head -n1 | cut -d= -f2-)"
STLS_TLS="$(   grep -E '^TLS='      "$STLS_ENV" | head -n1 | cut -d= -f2-)"
STLS_PWD="$(   grep -E '^PASSWORD=' "$STLS_ENV" | head -n1 | cut -d= -f2-)"
STLS_PORT="${STLS_LISTEN##*:}"
TLS_DOMAIN="${STLS_TLS%%:*}"

if [[ -z "$SNELL_PSK" || -z "$STLS_PORT" || -z "$STLS_PWD" || -z "$TLS_DOMAIN" ]]; then
  echo "❌ 解析配置失败，请确认 ${SNELL_CFG} 和 ${STLS_ENV} 完整"
  exit 1
fi

# ---- 步骤 6: 探测公网 IP ----
PUBLIC_IP="$(detect_public_ip)"

# ---- 步骤 7: 拼接 Surge 配置行 ----
# 跟 install.sh 末尾完全一致，确保用户重复看到的是同一行
SURGE_LINE="Snell-STLS = snell, ${PUBLIC_IP}, ${STLS_PORT}, psk=${SNELL_PSK}, version=5, reuse=true, shadow-tls-password=${STLS_PWD}, shadow-tls-version=3, shadow-tls-sni=${TLS_DOMAIN}"

# ---- 步骤 8: 输出 ----
if [[ "$MODE" == "surge-only" ]]; then
  echo "$SURGE_LINE"
  exit 0
fi

cat <<EOF

========== Snell + ShadowTLS 当前配置 ==========
服务器 IP        : ${PUBLIC_IP}
ShadowTLS 端口   : ${STLS_PORT}
Snell PSK        : ${SNELL_PSK}
ShadowTLS 密码   : ${STLS_PWD}
伪装 SNI         : ${TLS_DOMAIN}
Snell 后端端口   : ${BACKEND_PORT} （仅 127.0.0.1 监听）

========== Surge 配置行（复制整行到 Surge [Proxy] 段）==========
${SURGE_LINE}

EOF

# ---- 步骤 9: 渲染二维码 ----
if [[ "$RENDER_QR" -eq 1 ]]; then
  cat <<'EOF'
========== 二维码 ==========
⚠️ 这是 Surge 配置行的纯文本二维码，不是分享链接。
   - 用手机相机扫码 → 得到一段文字 → 复制粘贴到 Surge 配置文件
   - Snell v5 + ShadowTLS v3 是 Surge 独家组合，没有跨客户端 URI 标准
   - 想要"扫码即导入"，请用同项目 ../anytls/

EOF
  qrencode -t UTF8 -m 1 -l L "$SURGE_LINE"
  echo
fi

# ---- 步骤 10: 可选保存 PNG/SVG ----
if [[ -n "$PNG_PATH" ]]; then
  qrencode -t PNG -o "$PNG_PATH" -s 8 -m 2 -l L "$SURGE_LINE"
  echo "✅ 二维码 PNG 已保存：${PNG_PATH}"
fi
if [[ -n "$SVG_PATH" ]]; then
  qrencode -t SVG -o "$SVG_PATH" -m 2 -l L "$SURGE_LINE"
  echo "✅ 二维码 SVG 已保存：${SVG_PATH}"
fi

# ---- 步骤 11: 客户端导入指引 ----
if [[ "$RENDER_QR" -eq 1 ]]; then
  cat <<EOF

========== 客户端兼容情况 ==========
✅ Surge (iOS / macOS) — 唯一原生支持 Snell v5 + ShadowTLS v3
   把 Surge 配置行整行粘到 [Proxy] 段下

❌ 其它任何客户端（Shadowrocket / v2rayN / NekoBox 等）—— 用不了
   想跨平台请改用 AnyTLS（同项目 ../anytls/）
EOF
fi
