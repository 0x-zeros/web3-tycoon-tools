#!/usr/bin/env bash
#
# WireGuard 客户端密钥清理脚本（适用于 Ubuntu 24）
#
# 功能：删除 VPS 上的客户端私钥文件，提高安全性
# 前提：客户端配置文件已下载到本地或已扫码导入
#
# 安全说明：
#   - 客户端私钥已写入 client1.conf 和 client2.conf
#   - VPS 不需要保留客户端私钥（遵循最小权限原则）
#   - 删除后可降低 VPS 被入侵时的风险
#
# 使用方法：
#   sudo bash ubuntu_wireguard_cleanup_client_keys.sh
#

set -euo pipefail

echo "========================================="
echo "  WireGuard 客户端密钥清理工具"
echo "========================================="
echo ""

# 检查是否为 root
if [[ "$(id -u)" -ne 0 ]]; then
  echo "❌ 错误：需要 root 权限"
  echo "请使用：sudo bash $(basename "$0")"
  exit 1
fi

# 配置目录
WG_DIR="/etc/wireguard"

# 检查 WireGuard 配置目录是否存在
if [ ! -d "$WG_DIR" ]; then
  echo "❌ 错误：WireGuard 配置目录不存在: $WG_DIR"
  echo "提示：请先运行 ubuntu_wireguard_install.sh"
  exit 1
fi

# 切换到 WireGuard 目录
cd "$WG_DIR"

echo "📁 WireGuard 配置目录: $WG_DIR"
echo ""

# 定义要删除的客户端密钥文件
CLIENT_KEY_FILES=(
  "client1_private.key"
  "client1_public.key"
  "client2_private.key"
  "client2_public.key"
)

# 检查哪些文件存在
echo "🔍 检查客户端密钥文件..."
FILES_TO_DELETE=()
for file in "${CLIENT_KEY_FILES[@]}"; do
  if [ -f "$file" ]; then
    FILES_TO_DELETE+=("$file")
    echo "  ✓ 发现: $file"
  fi
done

# 如果没有文件需要删除
if [ ${#FILES_TO_DELETE[@]} -eq 0 ]; then
  echo ""
  echo "✅ 所有客户端密钥文件已清理（或未生成）"
  echo ""
  echo "保留的文件："
  ls -lh server_*.key wg0.conf client*.conf 2>/dev/null || echo "  （无服务端文件）"
  exit 0
fi

# 显示将要删除的文件
echo ""
echo "⚠️  将要删除以下客户端密钥文件："
for file in "${FILES_TO_DELETE[@]}"; do
  echo "  - $file"
done

echo ""
echo "✅ 保留的文件（服务端运行必需）："
echo "  - server_private.key (服务端私钥)"
echo "  - server_public.key (服务端公钥)"
echo "  - wg0.conf (服务端配置)"
echo "  - client1.conf (客户端配置，包含私钥)"
echo "  - client2.conf (客户端配置，包含私钥)"

echo ""
echo "⚠️  注意："
echo "  1. 删除前请确保客户端配置已保存到本地"
echo "  2. 删除后无法恢复，需重新运行安装脚本"
echo "  3. 服务端密钥不会被删除，WireGuard 服务继续运行"
echo ""

# 询问确认
read -rp "确认删除客户端密钥文件？(y/N): " confirm

if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo ""
  echo "❌ 已取消删除操作"
  exit 0
fi

# 执行删除
echo ""
echo "🗑️  正在删除客户端密钥文件..."
DELETED_COUNT=0
for file in "${FILES_TO_DELETE[@]}"; do
  if rm -f "$file"; then
    echo "  ✓ 已删除: $file"
    ((DELETED_COUNT++))
  else
    echo "  ✗ 删除失败: $file"
  fi
done

echo ""
echo "========================================="
echo "  清理完成"
echo "========================================="
echo ""
echo "📊 统计信息："
echo "  - 删除文件数: $DELETED_COUNT"
echo "  - 保留服务端密钥: server_private.key, server_public.key"
echo "  - 保留客户端配置: client1.conf, client2.conf"
echo ""
echo "💡 提示："
echo "  - WireGuard 服务继续正常运行"
echo "  - 客户端可以继续使用已导入的配置"
echo "  - VPS 安全性已提升（客户端私钥已清理）"
echo ""
echo "当前 /etc/wireguard/ 目录剩余文件："
ls -lh "$WG_DIR" | grep -v "^total" || true
echo ""
