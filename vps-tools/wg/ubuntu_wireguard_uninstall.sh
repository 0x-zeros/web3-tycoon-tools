#!/usr/bin/env bash
#
# WireGuard 卸载脚本（适用于 Ubuntu 24）
#
# 功能：停止 WireGuard 服务，清理配置文件和防火墙规则
# 注意：不会卸载 wireguard 软件包（可能有其他用途）
#
# 使用方法：
#   sudo bash ubuntu_wireguard_uninstall.sh
#

set -euo pipefail

echo "========================================="
echo "  停止并卸载 WireGuard"
echo "========================================="
echo ""

# 检查是否为 root
if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 运行：sudo bash $(basename "$0")"
  exit 1
fi

# WireGuard 配置（与安装脚本一致）
WG_IFACE="wg0"
WG_IPV4_NET="10.0.0.0/24"
WG_IPV6_NET="fd10:db31:203:ab31::/64"

echo "【1/4】停止 WireGuard 服务和接口..."

# 先停止 systemd 服务（即使 down 失败也能处理 unit 状态）
systemctl stop "wg-quick@${WG_IFACE}" 2>/dev/null || true

# 检查接口是否存在，存在则执行 down（执行 PostDown 清理规则）
if ip link show "${WG_IFACE}" >/dev/null 2>&1; then
  echo "  检测到 ${WG_IFACE} 接口，正在关闭..."
  wg-quick down "${WG_IFACE}" 2>/dev/null || echo "  wg-quick down 失败，将进行兜底清理"
else
  echo "  ${WG_IFACE} 接口不存在"
fi

echo "【2/4】禁用开机自启..."
if systemctl is-enabled --quiet "wg-quick@${WG_IFACE}" 2>/dev/null; then
  systemctl disable "wg-quick@${WG_IFACE}" 2>/dev/null || true
  echo "  已禁用 wg-quick@${WG_IFACE}"
else
  echo "  wg-quick@${WG_IFACE} 未设置开机自启"
fi

echo "【3/4】删除配置文件和密钥..."
if [ -d /etc/wireguard ]; then
  # 备份提示
  if [ -f "/etc/wireguard/${WG_IFACE}.conf" ] || [ -f /etc/wireguard/client1.conf ]; then
    echo "  警告：即将删除 /etc/wireguard/ 目录（包含所有配置和密钥）"
    read -rp "  是否继续删除？(y/N): " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
      rm -rf /etc/wireguard
      echo "  已删除 /etc/wireguard/"
    else
      echo "  已取消删除配置文件"
    fi
  else
    rm -rf /etc/wireguard
    echo "  已删除 /etc/wireguard/"
  fi
else
  echo "  /etc/wireguard/ 目录不存在"
fi

echo "【4/4】兜底清理防火墙规则..."

# 检测出网网卡（用于清理 MASQUERADE 规则）
MAIN_IF=$(ip -o -4 route show to default 2>/dev/null | awk '{print $5}' | head -n1 || true)
if [ -z "$MAIN_IF" ]; then
  MAIN_IF=$(ip -o -6 route show to default 2>/dev/null | awk '{print $5}' | head -n1 || true)
fi
if [ -z "$MAIN_IF" ]; then
  MAIN_IF=$(ip -o link show | awk -F': ' '{print $2}' | grep -v lo | head -n1 || true)
fi

# 清理 IPv4 规则（即使 wg-quick down 已执行，再删一次也无害）
iptables -D FORWARD -i "${WG_IFACE}" -s "${WG_IPV4_NET}" -j ACCEPT 2>/dev/null || true
iptables -D FORWARD -o "${WG_IFACE}" -d "${WG_IPV4_NET}" -j ACCEPT 2>/dev/null || true

if [ -n "$MAIN_IF" ]; then
  iptables -t nat -D POSTROUTING -s "${WG_IPV4_NET}" -o "${MAIN_IF}" -j MASQUERADE 2>/dev/null || true
  echo "  已清理 IPv4 防火墙规则（网卡: ${MAIN_IF}）"
else
  echo "  无法检测出网网卡，跳过 IPv4 NAT 规则清理"
fi

# 清理 IPv6 规则
ip6tables -D FORWARD -i "${WG_IFACE}" -s "${WG_IPV6_NET}" -j ACCEPT 2>/dev/null || true
ip6tables -D FORWARD -o "${WG_IFACE}" -d "${WG_IPV6_NET}" -j ACCEPT 2>/dev/null || true
echo "  已清理 IPv6 防火墙规则"

echo ""
echo "✅ 卸载完成！"
echo ""
echo "说明："
echo "  - WireGuard 服务已停止并禁用"
echo "  - ${WG_IFACE} 接口已关闭"
echo "  - 配置文件和密钥已删除"
echo "  - 防火墙规则已清理（包含兜底清理）"
echo "  - wireguard 软件包未卸载（如需卸载请运行：apt-get remove wireguard wireguard-tools）"
echo ""
echo "验证清理结果："
echo "  sudo iptables -L FORWARD -n -v | grep ${WG_IPV4_NET}"
echo "  sudo ip6tables -L FORWARD -n -v | grep ${WG_IPV6_NET}"
echo "  ip link show ${WG_IFACE}"
echo ""
echo "如需重新安装，请运行："
echo "  sudo bash ubuntu_wireguard_install.sh"
echo ""
