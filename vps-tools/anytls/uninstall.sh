#!/usr/bin/env bash
# ============================================================
# 工具：AnyTLS（sing-box）一键卸载
# 维护：vps-tools
# ============================================================
#
# 用途
#   完整移除 install.sh 安装的全部内容：
#     - systemd 服务（sing-box.service）
#     - 配置目录（/etc/sing-box，含证书 + ACME 缓存）
#     - 二进制（/usr/local/bin/sing-box）
#     - 系统用户 sing-box
#
# 用法
#   sudo bash uninstall.sh
#
# 注意
#   未运行 install.sh 的环境运行本脚本是安全的。
# ============================================================

set -euo pipefail

# ---- 步骤 0: 守卫 root ----
if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash $(basename "$0")"
  exit 1
fi

echo "========================================="
echo "  停止并卸载 sing-box (AnyTLS)"
echo "========================================="
echo

# ---- 步骤 1: 停服务 ----
echo "【1/5】停止服务..."
systemctl stop sing-box.service 2>/dev/null || echo "  sing-box.service 未运行或不存在"

# ---- 步骤 2: 禁用 + 删 unit ----
echo "【2/5】禁用并删除 systemd unit..."
systemctl disable sing-box.service 2>/dev/null || true
rm -f /etc/systemd/system/sing-box.service
systemctl daemon-reload

# ---- 步骤 3: 删配置目录 ----
# 一次性删干净 config + 自签证书 + ACME 缓存（acme/）
echo "【3/5】删除配置目录 /etc/sing-box ..."
rm -rf /etc/sing-box

# ---- 步骤 4: 删二进制 ----
echo "【4/5】删除二进制..."
rm -f /usr/local/bin/sing-box

# ---- 步骤 5: 删系统用户 ----
echo "【5/5】删除系统用户 sing-box..."
if id sing-box &>/dev/null; then
  userdel sing-box
  echo "  系统用户 sing-box 已删除"
else
  echo "  系统用户 sing-box 不存在，跳过"
fi

echo
echo "✅ 卸载完成"
echo
echo "若要重装：sudo bash install.sh"
