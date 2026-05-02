#!/usr/bin/env bash
set -euo pipefail

echo "========================================="
echo "  停止并卸载 Snell + ShadowTLS"
echo "========================================="
echo ""

# 检查是否为 root
if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash $(basename "$0")"
  exit 1
fi

echo "【1/4】停止服务..."
systemctl stop snell.service 2>/dev/null || echo "  snell.service 未运行"
systemctl stop shadowtls.service 2>/dev/null || echo "  shadowtls.service 未运行"

echo "【2/4】禁用并删除 systemd 服务文件..."
systemctl disable snell.service 2>/dev/null || true
systemctl disable shadowtls.service 2>/dev/null || true
rm -f /etc/systemd/system/snell.service
rm -f /etc/systemd/system/shadowtls.service
systemctl daemon-reload

echo "【3/4】删除配置文件..."
rm -rf /etc/snell
rm -rf /etc/shadowtls

echo "【4/4】删除二进制文件..."
rm -f /usr/local/bin/snell-server
rm -f /usr/local/bin/shadow-tls

echo ""
echo "✅ 卸载完成！"
echo ""
echo "现在您可以重新运行安装脚本："
echo "sudo bash ubuntu_surge_stls_install.sh"
