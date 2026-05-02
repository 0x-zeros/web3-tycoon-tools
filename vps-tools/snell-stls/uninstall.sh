#!/usr/bin/env bash
# ============================================================
# 工具：Snell v5 + ShadowTLS v3 一键卸载
# 维护：vps-tools
# ============================================================
#
# 用途
#   完整移除 install.sh 安装的全部内容：
#     - systemd 服务（snell.service / shadowtls.service）
#     - 配置目录（/etc/snell / /etc/shadowtls）
#     - 二进制（/usr/local/bin/snell-server / shadow-tls）
#     - 系统用户 snell
#
# 用法
#   sudo bash uninstall.sh
#
# 注意
#   未运行 install.sh 的环境运行本脚本是安全的：每一步都做了"不存在则跳过"。
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

echo "========================================="
echo "  停止并卸载 Snell + ShadowTLS"
echo "========================================="
echo

# ---- 步骤 1: 停服务 ----
# stop 容错：服务未跑/不存在不应让脚本失败
echo "【1/5】停止服务..."
systemctl stop shadowtls.service 2>/dev/null || echo "  shadowtls.service 未运行或不存在"
systemctl stop snell.service 2>/dev/null || echo "  snell.service 未运行或不存在"

# ---- 步骤 2: 禁用 + 删 unit 文件 ----
echo "【2/5】禁用并删除 systemd unit..."
systemctl disable snell.service 2>/dev/null || true
systemctl disable shadowtls.service 2>/dev/null || true
rm -f /etc/systemd/system/snell.service
rm -f /etc/systemd/system/shadowtls.service
systemctl daemon-reload
systemctl reset-failed snell.service shadowtls.service 2>/dev/null || true

# ---- 步骤 3: 删配置目录 ----
echo "【3/5】删除配置目录..."
rm -rf /etc/snell
rm -rf /etc/shadowtls

# ---- 步骤 4: 删二进制 ----
echo "【4/5】删除二进制..."
rm -f /usr/local/bin/snell-server
rm -f /usr/local/bin/shadow-tls

# ---- 步骤 5: 删系统用户 ----
# 必须在删完所有 snell 拥有的文件后再 userdel，否则 userdel 会拒绝
# （或者保留这些文件成为孤儿）
echo "【5/5】删除系统用户 snell..."
if id snell &>/dev/null; then
  userdel snell
  echo "  系统用户 snell 已删除"
else
  echo "  系统用户 snell 不存在，跳过"
fi

echo
echo "✅ 卸载完成"
echo
echo "若要重装：sudo bash install.sh"
