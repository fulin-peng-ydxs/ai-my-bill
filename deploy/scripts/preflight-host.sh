#!/usr/bin/env bash
set -euo pipefail
# 在目标 Linux 上只读执行。门禁失败不创建目录、不拉镜像、不启动容器、更不清理既有业务。
[[ $# == 2 ]] || { echo '用法: preflight-host.sh <内网IPv4> <HTTPS端口>' >&2; exit 2; }
bind_ip="$1"; https_port="$2"
[[ "$https_port" =~ ^[0-9]+$ ]] && (( https_port >= 1024 && https_port <= 65535 )) || exit 2
IFS=. read -r octet_a octet_b octet_c octet_d extra <<< "$bind_ip"
[[ -z "${extra:-}" ]] || exit 2
for octet in "$octet_a" "$octet_b" "$octet_c" "$octet_d"; do
  [[ "$octet" =~ ^(0|[1-9][0-9]{0,2})$ ]] && (( octet <= 255 )) || exit 2
done
(( octet_a == 10 || (octet_a == 172 && octet_b >= 16 && octet_b <= 31) || (octet_a == 192 && octet_b == 168) )) || exit 2
failures=0
fail() { echo "FAIL: $*"; failures=$((failures+1)); }
source /etc/os-release
case "$ID:$VERSION_ID" in
  ubuntu:22.04|ubuntu:24.04|debian:12|debian:13|rocky:9*|rocky:10*|almalinux:9*|almalinux:10*|rhel:9*|rhel:10*) echo "OK: OS $ID $VERSION_ID" ;;
  *) fail "未在受维护的目标 OS 基线中: $ID $VERSION_ID；需核实支持状态，不能通过容器替代宿主补丁。" ;;
esac
if ! ip -4 -o addr show | awk '{print $4}' | cut -d/ -f1 | grep -Fxq "$bind_ip"; then
  fail '目标 IP 不是本机接口地址。'
fi
read -r available_kb used_percent < <(df -Pk /var/lib/docker | awk 'NR==2 {gsub(/%/,"",$5); print $4,$5}')
if (( available_kb < 10485760 || used_percent >= 85 )); then fail "Docker 文件系统余量不足：${used_percent}% 已用；至少 10GiB 空闲且使用率低于 85%。"; fi
memory_kb="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
(( memory_kb >= 2097152 )) || fail '可用内存不足 2GiB。'
if ! docker info >/dev/null 2>&1; then fail 'Docker daemon 不可用。'; fi
if ! docker compose version >/dev/null 2>&1; then fail 'Docker Compose v2 不可用。'; fi
if ss -H -lnt | awk '{print $4}' | grep -Eq ":${https_port}$"; then fail 'HTTPS 端口已被监听。'; fi
# Swarm ingress 发布端口不一定由 ss 呈现，所以同时核对服务发布信息。
if [[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" == active ]]; then
  if ports="$(docker service ls --format '{{.Ports}}' 2>/dev/null)"; then
    if grep -Eq ":${https_port}->" <<< "$ports"; then fail 'HTTPS 端口已被 Swarm 发布。'; fi
  else fail '无法核实 Swarm 发布端口；请由集群管理节点确认。'; fi
fi
(( failures == 0 )) || { echo "部署前检查失败: $failures 项；未修改服务器。"; exit 1; }
echo '资源与基础环境预检通过；仍须验收补丁、证书信任、允许网段、镜像摘要和备份恢复。'
