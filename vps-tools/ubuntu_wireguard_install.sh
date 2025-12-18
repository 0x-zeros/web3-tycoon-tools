#!/bin/bash
#
# WireGuard 简易安装脚本（适用于 Ubuntu 24 + 仅 IPv6 公网 VPS，例如 AWS）
#
# 使用前提：
#   - 必须使用 root 运行（例如先执行：sudo -i）
#   - VPS 只有 IPv6 公网地址（没有 IPv4 公网）
#   - 操作系统为 Ubuntu 24（官方源中自带 WireGuard 软件包）
#   - 云厂商安全组 / 防火墙（如 AWS Security Group）需要你在网页控制台手动放行 UDP 端口
#
# 本脚本做的事情：
#   - 安装：wireguard, wireguard-tools, qrencode, curl, iptables（包含 ip6tables 命令）
#   - 生成 1 组服务端密钥 + 2 组客户端密钥
#   - 生成服务端配置：/etc/wireguard/wg0.conf
#   - 生成 2 个客户端配置：/etc/wireguard/client1.conf 和 client2.conf
#   - 开启 IPv4 / IPv6 转发
#   - 使用服务器 IPv6 公网地址作为 Endpoint，客户端走全局流量 (0.0.0.0/0, ::/0)
#   - 为每个客户端配置生成二维码，方便 WireGuard 客户端扫码导入
#
# 重要说明：
#   - 你必须在云厂商控制台中手动放行 WG_PORT（默认 51820）的 UDP 端口。
#   - IPv6 一般不需要 NAT，本脚本只为 IPv6 添加转发规则（FORWARD），不做 IPv6 NAT。
#   - 保留了一些 ip6tables NAT 的示例（注释掉），仅供测试用，不熟悉请不要打开。
#
# 安全提示：
#   - 本脚本生成的密钥保存在 /etc/wireguard/ 目录，权限为 600（仅 root 可读）
#   - 请确保服务器 SSH 密钥安全，避免未授权访问（密钥泄露 = VPN 完全失陷）
#   - 备份 /etc/wireguard/ 时请使用加密存储（如 GPG 加密的备份文件）
#   - 建议定期轮换 WireGuard 密钥（重新运行脚本并更新客户端配置）
#   - 本脚本的防火墙规则已限定只允许 WireGuard 网段流量，但仍需配合云厂商安全组使用
#
# 使用方法：
#   1）在服务器上：
#        sudo -i
#        chmod +x ubuntu_wireguard_install.sh
#        ./ubuntu_wireguard_install.sh
#   2）在云控制台（如 AWS Security Group）中手动放行 UDP WG_PORT 端口（默认 51820）。
#   3）在客户端：
#        - 使用 WireGuard 手机/桌面客户端扫描终端里显示的二维码，或
#        - 将 /etc/wireguard/client1.conf 或 client2.conf 拷贝到本地导入。
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

### 基本配置（如需调整端口或内网网段，可以改这里）

WG_IFACE="wg0"                        # WireGuard 网卡名称
WG_PORT=51820                         # WireGuard 监听端口（UDP）
WG_IPV4_NET="10.0.0.0/24"             # 隧道内 IPv4 网段（目前只用到 10.0.0.1/2/3）
WG_IPV6_NET="fd10:db31:203:ab31::/64" # 隧道内 IPv6 网段（目前只用到 ::1/::2/::3）

# 服务端在隧道内的 IPv4 / IPv6 地址
WG_IPV4_SERVER="10.0.0.1"
WG_IPV6_SERVER="fd10:db31:203:ab31::1"

# 客户端 1 在隧道内的 IPv4 / IPv6 地址
WG_IPV4_CLIENT1="10.0.0.2"
WG_IPV6_CLIENT1="fd10:db31:203:ab31::2"

# 客户端 2 在隧道内的 IPv4 / IPv6 地址
WG_IPV4_CLIENT2="10.0.0.3"
WG_IPV6_CLIENT2="fd10:db31:203:ab31::3"

# DNS 服务器配置（默认 Cloudflare）
DNS_SERVERS="1.1.1.1,2606:4700:4700::1111"  # 客户端使用的 DNS
MTU=1420                                     # MTU 一般 1420 即可

### 简单日志函数（只是输出前缀）

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
  # 使用 ping6 或 ip 命令验证格式（如果地址格式错误，这些命令会失败）
  if command -v ping6 >/dev/null 2>&1; then
    ping6 -c 1 -W 1 "$ipv6" >/dev/null 2>&1 && return 0
  fi
  # 备用验证：尝试用 ip 命令解析
  if ip -6 route get "$ipv6" >/dev/null 2>&1; then
    return 0
  fi
  # 如果上述验证都不可用，使用正则表达式进行基础验证
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

# 简单判断是不是 Debian/Ubuntu 系统（有 apt-get 就基本可以）
if ! command -v apt-get >/dev/null 2>&1; then
  error "本脚本仅适用于使用 apt-get 的 Debian/Ubuntu 系统。"
  exit 1
fi

### 1.5. 选择 DNS 服务器

info "请选择客户端使用的 DNS 服务器："
echo "  1) Cloudflare (1.1.1.1, 2606:4700:4700::1111) [默认]"
echo "  2) Google (8.8.8.8, 2001:4860:4860::8888)"
echo "  3) 阿里云 (223.5.5.5, 2400:3200::1)"
echo "  4) 腾讯云 (119.29.29.29, 2402:4e00::)"
echo "  5) 自定义"

read -rp "请输入选项 (1-5, 默认为 1): " dns_choice

case "${dns_choice:-1}" in
  1)
    DNS_SERVERS="1.1.1.1,2606:4700:4700::1111"
    info "已选择 Cloudflare DNS"
    ;;
  2)
    DNS_SERVERS="8.8.8.8,2001:4860:4860::8888"
    info "已选择 Google DNS"
    ;;
  3)
    DNS_SERVERS="223.5.5.5,2400:3200::1"
    info "已选择阿里云 DNS"
    ;;
  4)
    DNS_SERVERS="119.29.29.29,2402:4e00::"
    info "已选择腾讯云 DNS"
    ;;
  5)
    read -rp "请输入自定义 DNS（格式：IPv4,IPv6 或仅 IPv4）： " DNS_SERVERS
    info "已设置自定义 DNS: ${DNS_SERVERS}"
    ;;
  *)
    warn "无效选项，使用默认 Cloudflare DNS"
    DNS_SERVERS="1.1.1.1,2606:4700:4700::1111"
    ;;
esac

### 2. 安装依赖软件

SCRIPT_STAGE="安装依赖软件"

info "更新软件包索引并安装所需软件..."
apt-get update -y
apt-get install -y wireguard wireguard-tools qrencode curl iptables

### 3. 准备 WireGuard 配置目录

info "创建 /etc/wireguard 目录并设置权限..."
mkdir -p /etc/wireguard
chmod 700 /etc/wireguard
cd /etc/wireguard

### 4. 生成密钥（服务端 + 2 个客户端）

SCRIPT_STAGE="生成密钥"

info "生成服务端和两个客户端的密钥对..."

# 服务端密钥：wg genkey 生成私钥，管道给 wg pubkey 生成公钥
wg genkey | tee server_private.key | wg pubkey > server_public.key
chmod 600 server_private.key server_public.key

# 客户端 1 密钥
wg genkey | tee client1_private.key | wg pubkey > client1_public.key
chmod 600 client1_private.key client1_public.key

# 客户端 2 密钥
wg genkey | tee client2_private.key | wg pubkey > client2_public.key
chmod 600 client2_private.key client2_public.key

# 从文件中读出密钥内容，后面写入配置文件用
SERVER_PRIVATE_KEY=$(cat server_private.key)
SERVER_PUBLIC_KEY=$(cat server_public.key)

CLIENT1_PRIVATE_KEY=$(cat client1_private.key)
CLIENT1_PUBLIC_KEY=$(cat client1_public.key)

CLIENT2_PRIVATE_KEY=$(cat client2_private.key)
CLIENT2_PUBLIC_KEY=$(cat client2_public.key)

### 5. 获取服务器 IPv6 公网地址

info "尝试自动检测服务器 IPv6 公网地址..."

# 优先方案1：从本地网卡配置中提取IPv6公网地址
# 排除本地链路地址(fe80)、ULA地址(fc00/fd00)，只取全局单播地址
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
  warn "输入的 IPv6 地址格式不正确或无法访问: ${SERVER_IPV6}"
  read -rp "请重新输入有效的服务器 IPv6 公网地址： " SERVER_IPV6
done

info "服务器 Endpoint 将使用: [${SERVER_IPV6}]:${WG_PORT}"

### 6. 检测出网网卡名称（用于做 NAT）

info "检测服务器主要出网网卡名称..."

# 优先尝试通过 IPv6 默认路由找出网网卡（适用于 IPv6-only VPS）
MAIN_IF=$(ip -o -6 route show to default 2>/dev/null | awk '{print $5}' | head -n1 || true)

# 如果 IPv6 默认路由找不到，再尝试 IPv4 默认路由
if [ -z "$MAIN_IF" ]; then
  MAIN_IF=$(ip -o -4 route show to default 2>/dev/null | awk '{print $5}' | head -n1 || true)
fi

# 如果都找不到，就退化为"第一个非 lo 网卡"
if [ -z "$MAIN_IF" ]; then
  MAIN_IF=$(ip -o link show | awk -F': ' '{print $2}' | grep -v lo | head -n1 || true)
fi

if [ -z "$MAIN_IF" ]; then
  error "无法自动检测出网网卡，请在脚本中手动设置 MAIN_IF。"
  exit 1
fi

info "使用的出网网卡为: ${MAIN_IF}"

# 校验网卡名称格式（只允许字母、数字、下划线、短横线、点）
if [[ ! "$MAIN_IF" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
  error "检测到的网卡名称格式异常: ${MAIN_IF}，请手动检查"
  exit 1
fi

### 7. 开启 IPv4 和 IPv6 转发

info "开启 IPv4 和 IPv6 转发功能..."

# 立即生效的内核参数设置
sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null

# 写入 /etc/sysctl.conf，保证重启后依然生效
# 使用sed修改已有配置，或追加新配置（避免重复配置冲突）
if grep -q "^[[:space:]]*net.ipv4.ip_forward" /etc/sysctl.conf 2>/dev/null; then
  sed -i 's/^[[:space:]]*net.ipv4.ip_forward.*/net.ipv4.ip_forward = 1/' /etc/sysctl.conf
  info "已更新 net.ipv4.ip_forward = 1"
else
  echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf
  info "已添加 net.ipv4.ip_forward = 1"
fi

if grep -q "^[[:space:]]*net.ipv6.conf.all.forwarding" /etc/sysctl.conf 2>/dev/null; then
  sed -i 's/^[[:space:]]*net.ipv6.conf.all.forwarding.*/net.ipv6.conf.all.forwarding = 1/' /etc/sysctl.conf
  info "已更新 net.ipv6.conf.all.forwarding = 1"
else
  echo "net.ipv6.conf.all.forwarding = 1" >> /etc/sysctl.conf
  info "已添加 net.ipv6.conf.all.forwarding = 1"
fi

### 8. 生成服务端配置 wg0.conf

info "生成 /etc/wireguard/${WG_IFACE}.conf ..."

cat > "/etc/wireguard/${WG_IFACE}.conf" <<EOF
[Interface]
# 服务端的私钥（非常重要，请勿泄露）
PrivateKey = ${SERVER_PRIVATE_KEY}

# 服务端在隧道内的地址（一个 IPv4 + 一个 IPv6）
Address = ${WG_IPV4_SERVER}/24
Address = ${WG_IPV6_SERVER}/64

ListenPort = ${WG_PORT}
MTU = ${MTU}

# IPv4 防火墙及 NAT 规则（精细化版本）：
# - FORWARD 规则限定 WireGuard 网段，防止非法流量
# - NAT 只针对 WireGuard 网段，避免影响服务器其他流量
PostUp   = iptables -A FORWARD -i ${WG_IFACE} -s ${WG_IPV4_NET} -j ACCEPT; iptables -A FORWARD -o ${WG_IFACE} -d ${WG_IPV4_NET} -j ACCEPT; iptables -t nat -A POSTROUTING -s ${WG_IPV4_NET} -o ${MAIN_IF} -j MASQUERADE
PostDown = iptables -D FORWARD -i ${WG_IFACE} -s ${WG_IPV4_NET} -j ACCEPT; iptables -D FORWARD -o ${WG_IFACE} -d ${WG_IPV4_NET} -j ACCEPT; iptables -t nat -D POSTROUTING -s ${WG_IPV4_NET} -o ${MAIN_IF} -j MASQUERADE

# IPv6 防火墙规则：只做转发，不做 NAT
PostUp   = ip6tables -A FORWARD -i ${WG_IFACE} -j ACCEPT; ip6tables -A FORWARD -o ${WG_IFACE} -j ACCEPT
PostDown = ip6tables -D FORWARD -i ${WG_IFACE} -j ACCEPT; ip6tables -D FORWARD -o ${WG_IFACE} -j ACCEPT

# IPv6 NAT 示例（一般用不到，除非你非常清楚自己要做什么）
#PostUp   = ip6tables -t nat -A POSTROUTING -o ${MAIN_IF} -j MASQUERADE
#PostDown = ip6tables -t nat -D POSTROUTING -o ${MAIN_IF} -j MASQUERADE

# 客户端 1：在服务端视角下允许的隧道内 IP
[Peer]
PublicKey = ${CLIENT1_PUBLIC_KEY}
# 每个客户端一个固定 IP（IPv4 /32 + IPv6 /128）
AllowedIPs = ${WG_IPV4_CLIENT1}/32, ${WG_IPV6_CLIENT1}/128

# 客户端 2
[Peer]
PublicKey = ${CLIENT2_PUBLIC_KEY}
AllowedIPs = ${WG_IPV4_CLIENT2}/32, ${WG_IPV6_CLIENT2}/128
EOF

chmod 600 "/etc/wireguard/${WG_IFACE}.conf"

### 9. 生成客户端 client1.conf 和 client2.conf

info "生成 client1.conf 和 client2.conf ..."

# 客户端 1 配置
cat > /etc/wireguard/client1.conf <<EOF
[Interface]
# 客户端 1 私钥
PrivateKey = ${CLIENT1_PRIVATE_KEY}
# 客户端在隧道内的 IPv4/IPv6 地址
Address = ${WG_IPV4_CLIENT1}/32
Address = ${WG_IPV6_CLIENT1}/128
# 使用服务器为其提供 DNS（或公共 DNS）
DNS = ${DNS_SERVERS}
MTU = ${MTU}

[Peer]
# 对端为服务器，使用服务器公钥
PublicKey = ${SERVER_PUBLIC_KEY}
# 使用服务器 IPv6 公网地址和端口
Endpoint = [${SERVER_IPV6}]:${WG_PORT}
# 把所有 IPv4 和 IPv6 流量都走隧道
AllowedIPs = 0.0.0.0/0, ::/0
# NAT 环境下保持心跳（秒），一般 25 即可
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/client1.conf

# 客户端 2 配置
cat > /etc/wireguard/client2.conf <<EOF
[Interface]
PrivateKey = ${CLIENT2_PRIVATE_KEY}
Address = ${WG_IPV4_CLIENT2}/32
Address = ${WG_IPV6_CLIENT2}/128
DNS = ${DNS_SERVERS}
MTU = ${MTU}

[Peer]
PublicKey = ${SERVER_PUBLIC_KEY}
Endpoint = [${SERVER_IPV6}]:${WG_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/client2.conf

### 10. 启动 WireGuard 并设为开机自启

SCRIPT_STAGE="启动WireGuard"

info "启动 WireGuard 接口 ${WG_IFACE}..."

# 如果 wg0 已经存在，先尝试关闭（失败忽略）
wg-quick down "${WG_IFACE}" 2>/dev/null || true

# 启动 wg0
wg-quick up "${WG_IFACE}"

# 设置为开机自动启动
if ! systemctl enable "wg-quick@${WG_IFACE}" >/dev/null 2>&1; then
  warn "设置开机自启失败，请稍后手动执行：systemctl enable wg-quick@${WG_IFACE}"
else
  info "已设置 WireGuard 开机自启"
fi

### 11. 显示状态和二维码

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
info "全部完成。"
echo " - 服务器 Endpoint: [${SERVER_IPV6}]:${WG_PORT}"
echo " - WireGuard 接口名称: ${WG_IFACE}"
echo " - 请在云厂商防火墙 / 安全组中放行 UDP 端口 ${WG_PORT}。"
echo