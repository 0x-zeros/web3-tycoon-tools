#!/bin/bash
#
# WireGuard 安装脚本（IPv6-only VPS 专用版）
# 适用于：AWS Lightsail IPv6-only 实例
#
# 使用前提：
#   - 必须使用 root 运行（例如先执行：sudo -i）
#   - VPS 只有 IPv6 公网地址（AWS Lightsail IPv6-only）
#   - 操作系统为 Ubuntu 24（官方源中自带 WireGuard 软件包）
#   - Lightsail 防火墙需要放行 UDP 51820 端口
#
# 本脚本做的事情：
#   - 安装：wireguard, wireguard-tools, qrencode, curl, iptables
#   - 生成服务端和客户端密钥
#   - 配置纯IPv6的WireGuard隧道
#   - 配置DNS64支持，让客户端能访问IPv4网站
#   - 生成客户端配置和二维码
#
# 重要说明：
#   - 本脚本只配置IPv6，不配置IPv4
#   - 通过DNS64+NAT64让客户端能访问IPv4网站
#   - 你必须在Lightsail控制台放行UDP 51820端口
#
# 安全提示：
#   - 本脚本生成的密钥保存在 /etc/wireguard/ 目录，权限为 600（仅 root 可读）
#   - 请确保服务器 SSH 密钥安全，避免未授权访问（密钥泄露 = VPN 完全失陷）
#   - 备份 /etc/wireguard/ 时请使用加密存储（如 GPG 加密的备份文件）
#   - 建议定期轮换 WireGuard 密钥（重新运行脚本并更新客户端配置）
#
# 使用方法：
#   1）在服务器上：
#        sudo -i
#        chmod +x ubuntu_wireguard_install_ipv6only.sh
#        ./ubuntu_wireguard_install_ipv6only.sh
#   2）在Lightsail控制台中手动放行 UDP 51820 端口
#   3）在客户端：
#        - 使用 WireGuard 手机/桌面客户端扫码导入，或
#        - 将 /etc/wireguard/client1.conf 或 client2.conf 拷贝到本地导入
#

# 严格错误处理：
# - set -e: 任意命令返回非0时立即退出
# - set -u: 使用未定义变量时报错退出
# - set -o pipefail: 管道中任意命令失败时整个管道返回失败
set -e
set -u
set -o pipefail

### 清理函数和错误处理

# 脚本开始时的状态标记
SCRIPT_STAGE="init"

cleanup_on_error() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo ""
    echo "[ERROR] 脚本在 ${SCRIPT_STAGE} 阶段执行失败 (退出码: ${exit_code})"
    echo "[INFO] 正在尝试清理..."

    # 如果 WireGuard 接口已启动，尝试关闭
    if [ -n "${WG_IFACE:-}" ] && ip link show "${WG_IFACE}" >/dev/null 2>&1; then
      echo "[INFO] 关闭 WireGuard 接口 ${WG_IFACE}..."
      wg-quick down "${WG_IFACE}" 2>/dev/null || true
    fi

    echo "[INFO] 清理完成。请检查错误信息后重新运行脚本。"
  fi
}

trap cleanup_on_error EXIT

### 基本配置（IPv6专用）

WG_IFACE="wg0"                        # WireGuard 网卡名称
WG_PORT=51820                         # WireGuard 监听端口（UDP）
WG_IPV6_NET="fd10:db31:203:ab31::/64" # 隧道内 IPv6 网段
MTU=1420                              # MTU 一般 1420 即可

# 服务端在隧道内的 IPv6 地址
WG_IPV6_SERVER="fd10:db31:203:ab31::1"

# 客户端 1 在隧道内的 IPv6 地址
WG_IPV6_CLIENT1="fd10:db31:203:ab31::2"

# 客户端 2 在隧道内的 IPv6 地址
WG_IPV6_CLIENT2="fd10:db31:203:ab31::3"

# DNS 服务器（将在后面让用户选择）
DNS_SERVERS=""

### 简单日志函数

info()  { echo "[INFO] $*"; }
warn()  { echo "[WARN] $*"; }
error() { echo "[ERROR] $*" >&2; }

### IPv6 地址格式验证函数
validate_ipv6() {
  local ipv6="$1"
  # 简单的 IPv6 格式验证：至少包含一个冒号
  if [[ -z "$ipv6" ]]; then
    return 1
  fi
  # 检查是否包含冒号（IPv6的基本特征）
  if [[ ! "$ipv6" =~ : ]]; then
    return 1
  fi
  # 使用正则表达式进行基础验证
  if [[ "$ipv6" =~ ^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$ ]] || \
     [[ "$ipv6" =~ ^::([0-9a-fA-F]{0,4}:){0,6}[0-9a-fA-F]{0,4}$ ]] || \
     [[ "$ipv6" =~ ^([0-9a-fA-F]{0,4}:){1,6}:[0-9a-fA-F]{0,4}$ ]]; then
    return 0
  fi
  return 1
}

### 1. 基础检查

SCRIPT_STAGE="基础检查"

# 检查是否 root 用户
if [ "$(id -u)" -ne 0 ]; then
  error "必须使用 root 运行本脚本，例如先执行：sudo -i"
  exit 1
fi

# 简单判断是不是 Debian/Ubuntu 系统
if ! command -v apt-get >/dev/null 2>&1; then
  error "本脚本仅适用于使用 apt-get 的 Debian/Ubuntu 系统。"
  exit 1
fi

### 2. 安装依赖软件

SCRIPT_STAGE="安装依赖软件"

info "更新软件包索引并安装所需软件..."
apt-get update -y
apt-get install -y wireguard wireguard-tools qrencode curl iptables

### 3. 验证 IPv6 网络连接

SCRIPT_STAGE="验证IPv6连接"

info "验证VPS的IPv6网络连接..."

if ! ping6 -c 3 2001:4860:4860::8888 >/dev/null 2>&1; then
  error "VPS无法访问IPv6互联网！"
  error ""
  error "可能的原因："
  error "  1. AWS Lightsail防火墙未正确配置"
  error "  2. IPv6路由配置有问题"
  error ""
  error "请检查Lightsail防火墙设置，确保允许IPv6出站流量"
  exit 1
fi

info "IPv6网络连接正常 ✓"

### 4. 选择 DNS64 配置方式

info "请选择DNS64配置方式："
echo "  1) Google 公共 DNS64 (2001:4860:4860::6464) [推荐]"
echo "  2) Cloudflare 公共 DNS64 (2606:4700:4700::64)"
echo "  3) 自定义DNS"

read -rp "请输入选项 (1-3, 默认为 1): " dns64_choice

case "${dns64_choice:-1}" in
  1)
    DNS_SERVERS="2001:4860:4860::6464"
    info "已选择 Google DNS64"
    ;;
  2)
    DNS_SERVERS="2606:4700:4700::64"
    info "已选择 Cloudflare DNS64"
    ;;
  3)
    read -rp "请输入自定义 DNS（IPv6地址）： " DNS_SERVERS
    info "已设置自定义 DNS: ${DNS_SERVERS}"
    ;;
  *)
    warn "无效选项，使用默认 Google DNS64"
    DNS_SERVERS="2001:4860:4860::6464"
    ;;
esac

### 5. 准备 WireGuard 配置目录

info "创建 /etc/wireguard 目录并设置权限..."
mkdir -p /etc/wireguard
chmod 700 /etc/wireguard
cd /etc/wireguard

### 6. 生成密钥（服务端 + 2 个客户端）

SCRIPT_STAGE="生成密钥"

info "生成服务端和两个客户端的密钥对..."

# 服务端密钥
wg genkey | tee server_private.key | wg pubkey > server_public.key
chmod 600 server_private.key server_public.key

# 客户端 1 密钥
wg genkey | tee client1_private.key | wg pubkey > client1_public.key
chmod 600 client1_private.key client1_public.key

# 客户端 2 密钥
wg genkey | tee client2_private.key | wg pubkey > client2_public.key
chmod 600 client2_private.key client2_public.key

# 读取密钥内容
SERVER_PRIVATE_KEY=$(cat server_private.key)
SERVER_PUBLIC_KEY=$(cat server_public.key)

CLIENT1_PRIVATE_KEY=$(cat client1_private.key)
CLIENT1_PUBLIC_KEY=$(cat client1_public.key)

CLIENT2_PRIVATE_KEY=$(cat client2_private.key)
CLIENT2_PUBLIC_KEY=$(cat client2_public.key)

### 7. 获取服务器 IPv6 公网地址

info "尝试自动检测服务器 IPv6 公网地址..."

# 优先方案1：从本地网卡配置中提取IPv6公网地址
SERVER_IPV6=$(ip -6 addr show scope global 2>/dev/null | \
              grep -oP '(?<=inet6\s)[0-9a-f:]+(?=/)' | \
              grep -v '^fe80' | grep -v '^fc' | grep -v '^fd' | \
              head -n1 || true)

if [ -n "$SERVER_IPV6" ]; then
  info "从本地网卡获取到 IPv6 地址: ${SERVER_IPV6}"
fi

# 方案2：如果本地获取失败，使用HTTPS访问外部服务
if [ -z "$SERVER_IPV6" ]; then
  warn "从本地网卡获取IPv6失败，尝试使用外部服务..."
  SERVER_IPV6=$(curl -6 -s --max-time 5 https://api64.ipify.org 2>/dev/null || \
                curl -6 -s --max-time 5 https://ip.sb 2>/dev/null || true)
  if [ -n "$SERVER_IPV6" ]; then
    info "从外部服务获取到 IPv6 地址: ${SERVER_IPV6}"
  fi
fi

# 方案3：手动输入
if [ -z "$SERVER_IPV6" ]; then
  warn "自动检测 IPv6 地址失败。"
  read -rp "请输入服务器 IPv6 公网地址（例如 2406:xxxx:....）： " SERVER_IPV6
fi

# 验证 IPv6 地址格式
while ! validate_ipv6 "$SERVER_IPV6"; do
  warn "输入的 IPv6 地址格式不正确: ${SERVER_IPV6}"
  read -rp "请重新输入有效的服务器 IPv6 公网地址： " SERVER_IPV6
done

info "服务器 Endpoint 将使用: [${SERVER_IPV6}]:${WG_PORT}"

### 8. 检测出网网卡名称

info "检测服务器主要出网网卡名称..."

# 优先通过 IPv6 默认路由找出网网卡
MAIN_IF=$(ip -o -6 route show to default 2>/dev/null | awk '{print $5}' | head -n1 || true)

# Lightsail通常是ens5，作为后备
if [ -z "$MAIN_IF" ]; then
  if ip link show ens5 >/dev/null 2>&1; then
    MAIN_IF="ens5"
    info "使用Lightsail默认网卡: ens5"
  else
    MAIN_IF=$(ip -o link show | awk -F': ' '{print $2}' | grep -v lo | head -n1 || true)
  fi
fi

if [ -z "$MAIN_IF" ]; then
  error "无法自动检测出网网卡"
  exit 1
fi

info "使用的出网网卡为: ${MAIN_IF}"

# 校验网卡名称格式
if [[ ! "$MAIN_IF" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
  error "检测到的网卡名称格式异常: ${MAIN_IF}"
  exit 1
fi

### 9. 开启 IPv6 转发

SCRIPT_STAGE="配置IPv6转发"

info "开启 IPv6 转发功能..."

# 立即生效
sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null

# 写入配置文件（持久化）
if grep -q "^[[:space:]]*net.ipv6.conf.all.forwarding" /etc/sysctl.conf 2>/dev/null; then
  sed -i 's/^[[:space:]]*net.ipv6.conf.all.forwarding.*/net.ipv6.conf.all.forwarding = 1/' /etc/sysctl.conf
  info "已更新 net.ipv6.conf.all.forwarding = 1"
else
  echo "net.ipv6.conf.all.forwarding = 1" >> /etc/sysctl.conf
  info "已添加 net.ipv6.conf.all.forwarding = 1"
fi

### 10. 生成服务端配置 wg0.conf

info "生成 /etc/wireguard/${WG_IFACE}.conf ..."

cat > "/etc/wireguard/${WG_IFACE}.conf" <<EOF
[Interface]
# 服务端私钥
PrivateKey = ${SERVER_PRIVATE_KEY}

# 服务端IPv6地址（不配置IPv4）
Address = ${WG_IPV6_SERVER}/64

ListenPort = ${WG_PORT}
MTU = ${MTU}

# IPv6 防火墙规则（精细化版本）
# 说明：限定源/目标地址网段，只允许WireGuard网段的流量
PostUp   = ip6tables -A FORWARD -i ${WG_IFACE} -s ${WG_IPV6_NET} -j ACCEPT
PostUp   = ip6tables -A FORWARD -o ${WG_IFACE} -d ${WG_IPV6_NET} -j ACCEPT
PostDown = ip6tables -D FORWARD -i ${WG_IFACE} -s ${WG_IPV6_NET} -j ACCEPT
PostDown = ip6tables -D FORWARD -o ${WG_IFACE} -d ${WG_IPV6_NET} -j ACCEPT

# 客户端 1
[Peer]
PublicKey = ${CLIENT1_PUBLIC_KEY}
AllowedIPs = ${WG_IPV6_CLIENT1}/128

# 客户端 2
[Peer]
PublicKey = ${CLIENT2_PUBLIC_KEY}
AllowedIPs = ${WG_IPV6_CLIENT2}/128
EOF

chmod 600 "/etc/wireguard/${WG_IFACE}.conf"

### 11. 生成客户端配置

info "生成 client1.conf 和 client2.conf ..."

# 客户端 1 配置
cat > /etc/wireguard/client1.conf <<EOF
[Interface]
# 客户端 1 私钥
PrivateKey = ${CLIENT1_PRIVATE_KEY}

# 客户端IPv6地址（不配置IPv4）
Address = ${WG_IPV6_CLIENT1}/128

# 使用DNS64服务器（支持IPv4域名解析为IPv6地址）
DNS = ${DNS_SERVERS}
MTU = ${MTU}

[Peer]
# 服务器公钥
PublicKey = ${SERVER_PUBLIC_KEY}

# 服务器IPv6地址和端口
Endpoint = [${SERVER_IPV6}]:${WG_PORT}

# 只路由IPv6流量（客户端访问IPv4网站时，DNS64会返回IPv6地址）
AllowedIPs = ::/0

# 保持连接活跃
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/client1.conf

# 客户端 2 配置
cat > /etc/wireguard/client2.conf <<EOF
[Interface]
# 客户端 2 私钥
PrivateKey = ${CLIENT2_PRIVATE_KEY}

# 客户端IPv6地址（不配置IPv4）
Address = ${WG_IPV6_CLIENT2}/128

# 使用DNS64服务器
DNS = ${DNS_SERVERS}
MTU = ${MTU}

[Peer]
# 服务器公钥
PublicKey = ${SERVER_PUBLIC_KEY}

# 服务器IPv6地址和端口
Endpoint = [${SERVER_IPV6}]:${WG_PORT}

# 只路由IPv6流量
AllowedIPs = ::/0

# 保持连接活跃
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/client2.conf

### 12. 启动 WireGuard 并设为开机自启

SCRIPT_STAGE="启动WireGuard"

info "启动 WireGuard 接口 ${WG_IFACE}..."

# 如果 wg0 已经存在，先尝试关闭
wg-quick down "${WG_IFACE}" 2>/dev/null || true

# 启动 wg0
wg-quick up "${WG_IFACE}"

# 设置为开机自动启动
if ! systemctl enable "wg-quick@${WG_IFACE}" >/dev/null 2>&1; then
  warn "设置开机自启失败，请稍后手动执行：systemctl enable wg-quick@${WG_IFACE}"
else
  info "已设置 WireGuard 开机自启"
fi

### 13. 显示状态和二维码

echo
info "当前 WireGuard 状态："
wg show

echo
info "客户端 1 配置文件路径：/etc/wireguard/client1.conf"
info "客户端 2 配置文件路径：/etc/wireguard/client2.conf"

echo
info "客户端 1 二维码（可使用 WireGuard App 扫码导入）："
qrencode -t ansiutf8 < /etc/wireguard/client1.conf || true

echo
info "客户端 2 二维码："
qrencode -t ansiutf8 < /etc/wireguard/client2.conf || true

echo
info "全部完成！"
echo " - 服务器 Endpoint: [${SERVER_IPV6}]:${WG_PORT}"
echo " - WireGuard 接口名称: ${WG_IFACE}"
echo " - 请在Lightsail防火墙中放行 UDP 端口 ${WG_PORT}"
echo

### 14. 测试说明

echo
info "==== 测试步骤 ===="
echo
echo "1. 在客户端导入配置后，测试连接："
echo "   - 测试隧道连通性："
echo "     ping ${WG_IPV6_SERVER}  # 应该能ping通"
echo
echo "2. 测试IPv6互联网访问："
echo "   ping6 2001:4860:4860::8888  # Google IPv6 DNS"
echo "   curl -6 https://ipv6.google.com"
echo
echo "3. 测试IPv4网站访问（通过DNS64+NAT64）："
echo "   ping baidu.com  # DNS64会返回IPv6地址"
echo "   curl https://www.baidu.com"
echo
echo "4. 如果IPv4访问不通，检查："
echo "   - DNS是否设为 ${DNS_SERVERS}"
echo "   - 执行：nslookup baidu.com"
echo "   - 应该返回形如 64:ff9b::xxxx 的IPv6地址"
echo
echo "5. 调试命令："
echo "   - 查看WireGuard状态：wg show"
echo "   - 查看ip6tables规则：ip6tables -L FORWARD -v -n"
echo "   - 抓包分析：tcpdump -i wg0"
echo
