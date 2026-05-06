#!/usr/bin/env bash
# ============================================================
# 工具：AnyTLS 配置查看 + 二维码打印（Ubuntu 24.04）
# 维护：vps-tools
# ============================================================
#
# 用途
#   读取已部署的 sing-box AnyTLS 配置（/etc/sing-box/config.json），
#   重新打印：
#     - 标准 anytls:// 分享链接（anytls-go 官方 URI 规范）
#     - 终端 ANSI 二维码（用 qrencode 渲染，可手机直接扫）
#     - Surge 配置行（一行可粘贴）
#   首次安装时这些信息已在 install.sh 末尾打过；此脚本是"事后再看"用的。
#
# 前置条件
#   - 已运行过同目录 install.sh（存在 /etc/sing-box/config.json）
#   - 仅支持 Ubuntu 24.04
#   - 必须 root 运行（读 config.json 需要权限，文件是 sing-box:sing-box 640）
#   - 若缺 qrencode 会自动 apt-get install
#
# 用法
#   sudo bash print-qr.sh                  # 默认：打印 URI + Surge 行 + 终端二维码
#   sudo bash print-qr.sh --no-qr          # 仅文字，不渲染二维码
#   sudo bash print-qr.sh --png FILE       # 同时把二维码保存到 PNG
#   sudo bash print-qr.sh --svg FILE       # 同时把二维码保存到 SVG（矢量）
#   sudo bash print-qr.sh --uri-only       # 只输出 anytls:// 一行（管道友好）
#   sudo bash print-qr.sh --surge-only     # 只输出 Surge 配置一行
#
# 标准 URI 规范
#   https://github.com/anytls/anytls-go/blob/main/docs/uri_scheme.md
#   anytls://password@host:port/?sni=X[&insecure=1]
#
# 兼容客户端
#   📱 iOS         : Shadowrocket（直接扫码）
#   💻 Windows/Linux: v2rayN 7.14.6+
#   🤖 Android     : NekoBox for Android
#   🍎 macOS / iOS : Surge（用 Surge 配置行；Surge 不解析 anytls:// URI）
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
MODE="full"   # full | uri-only | surge-only

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-qr)        RENDER_QR=0; shift ;;
    --png)          PNG_PATH="${2:-}"; [[ -z "$PNG_PATH" ]] && { echo "❌ --png 需要文件路径"; exit 1; }; shift 2 ;;
    --svg)          SVG_PATH="${2:-}"; [[ -z "$SVG_PATH" ]] && { echo "❌ --svg 需要文件路径"; exit 1; }; shift 2 ;;
    --uri-only)     MODE="uri-only"; RENDER_QR=0; shift ;;
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
CFG="/etc/sing-box/config.json"
if [[ ! -r "$CFG" ]]; then
  echo "❌ 找不到 ${CFG}"
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

ensure_pkg jq jq
ensure_pkg curl curl

if [[ "$RENDER_QR" -eq 1 || -n "$PNG_PATH" || -n "$SVG_PATH" ]]; then
  ensure_pkg qrencode qrencode
fi

# ---- 工具函数 ----
# url_encode: 用 jq 做 RFC 3986 percent-encoding
#   AnyTLS URI 规范要求密码包含特殊字符时必须 percent-encode
#   本脚本生成的密码是 URL-safe base64，本就不需要编码；
#   但手动改过 config.json 的用户可能有特殊字符，统一编码更安全
url_encode() {
  jq -rn --arg s "$1" '$s|@uri'
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

# ---- 步骤 4: 读配置 ----
LISTEN_PORT="$(jq -r '.inbounds[0].listen_port' "$CFG")"
PASSWORD="$(jq -r '.inbounds[0].users[0].password' "$CFG")"
SERVER_NAME="$(jq -r '.inbounds[0].tls.server_name' "$CFG")"
# ACME 分支会有 .inbounds[0].tls.acme 对象；自签分支没有
ACME_DOMAIN="$(jq -r '.inbounds[0].tls.acme.domain[0] // empty' "$CFG")"

if [[ -z "$LISTEN_PORT" || "$LISTEN_PORT" == "null" ]]; then
  echo "❌ 解析 ${CFG} 失败（缺 listen_port）"
  exit 1
fi

if [[ -n "$ACME_DOMAIN" ]]; then
  DISPLAY_HOST="$ACME_DOMAIN"
  CERT_MODE="ACME"
  INSECURE=0
else
  DISPLAY_HOST="$(detect_public_ip)"
  CERT_MODE="self-signed"
  INSECURE=1
fi

# ---- 步骤 5: 拼接 URI 和 Surge 配置行 ----
ENC_PASSWORD="$(url_encode "$PASSWORD")"
ENC_SNI="$(url_encode "$SERVER_NAME")"

# IPv6 字面量在 URI 里要加 [...] 包裹
HOST_FOR_URI="$DISPLAY_HOST"
if [[ "$DISPLAY_HOST" =~ : && ! "$DISPLAY_HOST" =~ ^\[ ]]; then
  HOST_FOR_URI="[${DISPLAY_HOST}]"
fi

if [[ "$INSECURE" -eq 1 ]]; then
  ANYTLS_URI="anytls://${ENC_PASSWORD}@${HOST_FOR_URI}:${LISTEN_PORT}/?sni=${ENC_SNI}&insecure=1"
  SURGE_LINE="AnyTLS = anytls, ${DISPLAY_HOST}, ${LISTEN_PORT}, password=${PASSWORD}, sni=${SERVER_NAME}, skip-cert-verify=true"
else
  ANYTLS_URI="anytls://${ENC_PASSWORD}@${HOST_FOR_URI}:${LISTEN_PORT}/?sni=${ENC_SNI}"
  SURGE_LINE="AnyTLS = anytls, ${DISPLAY_HOST}, ${LISTEN_PORT}, password=${PASSWORD}, sni=${SERVER_NAME}"
fi

# ---- 步骤 6: 输出 ----
case "$MODE" in
  uri-only)
    echo "$ANYTLS_URI"
    exit 0
    ;;
  surge-only)
    echo "$SURGE_LINE"
    exit 0
    ;;
esac

cat <<EOF

========== AnyTLS 当前配置 ==========
服务器           : ${DISPLAY_HOST}
端口             : ${LISTEN_PORT}
密码             : ${PASSWORD}
SNI              : ${SERVER_NAME}
证书模式         : ${CERT_MODE}$([[ "$INSECURE" -eq 1 ]] && echo "（客户端必须 skip-cert-verify=true）")

========== 标准 anytls:// 分享链接 ==========
${ANYTLS_URI}

========== Surge 配置行（macOS / iOS Surge 用）==========
${SURGE_LINE}

EOF

# ---- 步骤 7: 渲染二维码 ----
if [[ "$RENDER_QR" -eq 1 ]]; then
  cat <<'EOF'
========== 二维码（手机相机扫码即可导入）==========
适用：📱 Shadowrocket(iOS)  💻 v2rayN(Win/Linux)  🤖 NekoBox(Android)
不适用：Surge（不解析 anytls:// URI，请用上面的"Surge 配置行"）

EOF
  # -t UTF8: 用 Unicode 半角块字符渲染，兼容大多数现代终端
  # -m 1   : 小边距，省屏幕空间
  # -l L   : 容错级别 Low，二维码更小（数据是 URL，本就稳）
  qrencode -t UTF8 -m 1 -l L "$ANYTLS_URI"
  echo
fi

# ---- 步骤 8: 可选保存 PNG/SVG ----
if [[ -n "$PNG_PATH" ]]; then
  qrencode -t PNG -o "$PNG_PATH" -s 8 -m 2 -l L "$ANYTLS_URI"
  echo "✅ 二维码 PNG 已保存：${PNG_PATH}"
fi
if [[ -n "$SVG_PATH" ]]; then
  qrencode -t SVG -o "$SVG_PATH" -m 2 -l L "$ANYTLS_URI"
  echo "✅ 二维码 SVG 已保存：${SVG_PATH}"
fi

# ---- 步骤 9: 客户端导入指引 ----
if [[ "$RENDER_QR" -eq 1 ]]; then
  cat <<EOF

========== 客户端导入指南 ==========
📱 Shadowrocket (iOS)
   首页右上角 ➕ → 选 "扫描二维码" → 对准上方 QR

💻 v2rayN (Windows/Linux, 7.14.6+)
   服务器 → 从剪贴板导入批量URL（先复制上方 anytls:// 链接）

🤖 NekoBox for Android
   配置 → ➕ → 扫描二维码

🍎 Surge (macOS / iOS)
   不支持 anytls:// URI；把上面的 "Surge 配置行" 整行粘到 [Proxy] 段下
EOF
fi
