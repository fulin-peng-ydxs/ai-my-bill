#!/usr/bin/env bash
set -euo pipefail

# 在可SSH的Linux上检查或准备项目宿主。managed-linux只安装缺失组件，既有Docker
# 一律不升级或替换；existing-linux始终只读。脚本不创建云资源、修改DNS或接管防火墙。

fail() { echo "错误：$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || fail "目标主机缺少命令：$1"; }

action=""
host_profile=""
package_source=""
timezone=""
firewall_mode=""
bind_ip=""
https_port=""
allow_eol_centos7="0"
min_docker_version=""
min_compose_version=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --action) action="${2:-}"; shift 2 ;;
    --host-profile) host_profile="${2:-}"; shift 2 ;;
    --package-source) package_source="${2:-}"; shift 2 ;;
    --timezone) timezone="${2:-}"; shift 2 ;;
    --firewall-mode) firewall_mode="${2:-}"; shift 2 ;;
    --bind-ip) bind_ip="${2:-}"; shift 2 ;;
    --https-port) https_port="${2:-}"; shift 2 ;;
    --allow-eol-centos7) allow_eol_centos7="${2:-}"; shift 2 ;;
    --min-docker-version) min_docker_version="${2:-}"; shift 2 ;;
    --min-compose-version) min_compose_version="${2:-}"; shift 2 ;;
    *) fail "未知参数：$1" ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || fail "宿主检查与准备必须由root执行"
[[ "${action}" == inspect || "${action}" == plan || "${action}" == apply || "${action}" == verify ]] || fail "action不合法"
[[ "${host_profile}" == existing-linux || "${host_profile}" == managed-linux ]] || fail "宿主profile不合法"
[[ "${package_source}" == preconfigured || "${package_source}" == docker-official ]] || fail "软件源模式不合法"
[[ "${firewall_mode}" == external ]] || fail "当前只支持由外部制度管理宿主防火墙"
[[ "${timezone}" =~ ^[A-Za-z0-9_+.-]+(/[A-Za-z0-9_+.-]+)+$ ]] || fail "时区不合法"
[[ "${https_port}" =~ ^[0-9]+$ ]] && (( https_port >= 1024 && https_port <= 65535 )) || fail "HTTPS端口不合法"
[[ "${allow_eol_centos7}" == 0 || "${allow_eol_centos7}" == 1 ]] || fail "CentOS7例外值不合法"
[[ "${min_docker_version}" =~ ^[0-9]+([.][0-9]+){1,2}$ ]] || fail "Docker最低版本不合法"
[[ "${min_compose_version}" =~ ^[0-9]+([.][0-9]+){1,2}$ ]] || fail "Compose最低版本不合法"
[[ -r /etc/os-release ]] || fail "缺少/etc/os-release，无法识别宿主"

# shellcheck disable=SC1091
source /etc/os-release
os_id="${ID,,}"
os_version="${VERSION_ID:-}"
os_codename="${VERSION_CODENAME:-}"
architecture="$(uname -m)"
os_family=""
supported="no"
legacy_exception="no"

case "${architecture}" in
  x86_64|aarch64|arm64) ;;
  *) fail "不支持的CPU架构：${architecture}" ;;
esac

case "${os_id}:${os_version}" in
  ubuntu:22.04|ubuntu:24.04) os_family=apt; supported=yes ;;
  debian:12|debian:13) os_family=apt; supported=yes ;;
  rocky:9*|rocky:10*|almalinux:9*|almalinux:10*|rhel:9*|rhel:10*) os_family=dnf; supported=yes ;;
  centos:7*)
    os_family=legacy
    if [[ "${host_profile}" == existing-linux && "${allow_eol_centos7}" == 1 && "${bind_ip}" == 10.100.101.104 ]]; then
      supported=yes
      legacy_exception=yes
    fi
    ;;
esac

version_ge() {
  local actual="${1#v}" required="${2#v}" index actual_part required_part
  local -a actual_parts required_parts
  IFS=. read -r -a actual_parts <<< "${actual%%[-+]*}"
  IFS=. read -r -a required_parts <<< "${required%%[-+]*}"
  for index in 0 1 2; do
    actual_part="${actual_parts[index]:-0}"
    required_part="${required_parts[index]:-0}"
    [[ "${actual_part}" =~ ^[0-9]+$ && "${required_part}" =~ ^[0-9]+$ ]] || return 1
    (( 10#${actual_part} > 10#${required_part} )) && return 0
    (( 10#${actual_part} < 10#${required_part} )) && return 1
  done
  return 0
}

command_available() { command -v "$1" >/dev/null 2>&1; }
docker_cli_available=false
docker_daemon_available=false
compose_available=false
python_available=false
python_command="missing"
systemd_available=false
docker_version="missing"
compose_version="missing"
python_version="missing"
current_timezone="unknown"
missing_commands=()

command_available docker && docker_cli_available=true
if [[ "${docker_cli_available}" == true ]] && docker info >/dev/null 2>&1; then
  docker_daemon_available=true
  docker_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
fi
if [[ "${docker_cli_available}" == true ]] && docker compose version >/dev/null 2>&1; then
  compose_available=true
  compose_version="$(docker compose version --short 2>/dev/null || true)"
fi
for candidate in python3 python; do
  if command_available "${candidate}" && "${candidate}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
    python_available=true
    python_command="${candidate}"
    python_version="$("${candidate}" -c 'import platform; print(platform.python_version())')"
    break
  fi
done
if command_available systemctl && [[ -d /run/systemd/system ]]; then systemd_available=true; fi
if command_available timedatectl; then
  current_timezone="$(timedatectl show -p Timezone 2>/dev/null | sed -n 's/^Timezone=//p' || true)"
  if [[ -z "${current_timezone}" ]]; then
    current_timezone="$(timedatectl status 2>/dev/null | sed -n 's/^[[:space:]]*Time zone:[[:space:]]*\([^[:space:]]*\).*/\1/p' || true)"
  fi
  [[ -n "${current_timezone}" ]] || current_timezone=unknown
fi

for command in awk cmp curl date grep install openssl sha256sum tar flock ss timeout logger; do
  command_available "${command}" || missing_commands+=("${command}")
done

ip_present=false
if command_available ip && ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -Fxq "${bind_ip}"; then
  ip_present=true
fi

disk_probe=/
[[ -d /var/lib/docker ]] && disk_probe=/var/lib/docker
[[ "${disk_probe}" == / && -d /var/lib ]] && disk_probe=/var/lib
read -r disk_available_kb disk_used_percent < <(df -Pk "${disk_probe}" | awk 'NR==2 {gsub(/%/,"",$5); print $4,$5}')
memory_available_kb="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"

print_facts() {
  printf 'hostProfile=%s\n' "${host_profile}"
  printf 'os=%s\n' "${os_id}:${os_version}"
  printf 'osFamily=%s\n' "${os_family:-unsupported}"
  printf 'supported=%s\n' "${supported}"
  printf 'legacyException=%s\n' "${legacy_exception}"
  printf 'architecture=%s\n' "${architecture}"
  printf 'systemd=%s\n' "${systemd_available}"
  printf 'python=%s:%s\n' "${python_command}" "${python_version}"
  printf 'docker=%s\n' "${docker_version}"
  printf 'compose=%s\n' "${compose_version}"
  printf 'bindIpPresent=%s\n' "${ip_present}"
  printf 'timezone=%s\n' "${current_timezone:-unknown}"
  printf 'diskProbe=%s\n' "${disk_probe}"
  printf 'diskAvailableKiB=%s\n' "${disk_available_kb}"
  printf 'diskUsedPercent=%s\n' "${disk_used_percent}"
  printf 'memoryAvailableKiB=%s\n' "${memory_available_kb}"
  printf 'missingCommands=%s\n' "${missing_commands[*]:-none}"
  printf 'firewallMode=%s\n' "${firewall_mode}"
}

verify_host() {
  local failures=0
  verify_fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
  [[ "${supported}" == yes ]] || verify_fail "宿主系统不在支持范围：${os_id} ${os_version}"
  [[ "${systemd_available}" == true ]] || verify_fail "systemd不是当前宿主服务管理器"
  [[ "${python_available}" == true ]] || verify_fail "需要Python 3.8+"
  [[ "${#missing_commands[@]}" -eq 0 ]] || verify_fail "缺少基础命令：${missing_commands[*]}"
  [[ "${docker_daemon_available}" == true ]] || verify_fail "Docker daemon不可用"
  [[ "${compose_available}" == true ]] || verify_fail "Docker Compose v2不可用"
  if [[ "${docker_daemon_available}" == true ]]; then
    version_ge "${docker_version}" "${min_docker_version}" || verify_fail "Docker ${docker_version}低于${min_docker_version}"
  fi
  if [[ "${compose_available}" == true ]]; then
    version_ge "${compose_version}" "${min_compose_version}" || verify_fail "Compose ${compose_version}低于${min_compose_version}"
  fi
  [[ "${ip_present}" == true ]] || verify_fail "绑定IP ${bind_ip} 不属于本机接口"
  (( memory_available_kb >= 2097152 )) || verify_fail "可用内存不足2GiB"
  (( disk_available_kb >= 10485760 && disk_used_percent < 85 )) || verify_fail "Docker所在文件系统需要至少10GiB空闲且使用率低于85%"
  [[ "${current_timezone}" == "${timezone}" ]] || verify_fail "宿主时区应为${timezone}，当前为${current_timezone:-unknown}"
  (( failures == 0 )) || fail "宿主验证失败：${failures}项"
  echo "PASS: 宿主环境满足项目运行前提；防火墙仍由外部网络/宿主制度管理。"
}

print_plan() {
  local conflicts=""
  print_facts
  [[ "${supported}" == yes ]] || fail "宿主系统不在支持范围，不能形成执行计划"
  if [[ "${host_profile}" == existing-linux ]]; then
    echo "change=none（existing-linux只检查，不安装或启动组件）"
    return
  fi
  [[ "${legacy_exception}" == no ]] || fail "CentOS7例外禁止managed-linux变更"
  [[ "${#missing_commands[@]}" -eq 0 && "${python_available}" == true ]] || echo "change=安装缺失的基础工具和Python3"
  if [[ "${docker_cli_available}" == false ]]; then
    conflicts="$(detect_docker_conflicts | tr '\n' ' ')"
    if [[ -n "${conflicts}" ]]; then
      echo "blocker=发现可能冲突的软件包，脚本不会自动删除：${conflicts}"
    else
      echo "change=从${package_source}软件源安装Docker Engine、Buildx和Compose插件"
    fi
  elif [[ "${compose_available}" == false ]]; then
    echo "blocker=检测到既有Docker但缺少Compose；拒绝混装，请先按原安装来源补齐Compose"
  elif [[ "${docker_daemon_available}" == false ]]; then
    echo "change=启用并启动既有Docker服务（不升级软件包）"
  else
    echo "change=保留既有Docker，不升级或替换"
  fi
  [[ "${current_timezone}" == "${timezone}" ]] || echo "change=设置宿主时区为${timezone}"
  echo "change=写入/var/lib/my-bill/operations/host-bootstrap.properties状态记录"
  echo "external=宿主防火墙、云安全组、DNS和端口映射不由本脚本修改"
}

installed_deb_packages() {
  local package
  for package in "$@"; do dpkg-query -W -f='${db:Status-Abbrev}' "${package}" 2>/dev/null | grep -q '^ii ' && printf '%s\n' "${package}"; done
}

installed_rpm_packages() {
  local package
  for package in "$@"; do rpm -q "${package}" >/dev/null 2>&1 && printf '%s\n' "${package}"; done
}

detect_docker_conflicts() {
  if [[ "${os_family}" == apt ]]; then
    installed_deb_packages docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc
  elif [[ "${os_family}" == dnf ]]; then
    installed_rpm_packages docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine podman-docker runc
  fi
}

install_base_packages() {
  local -a packages missing=()
  local package
  if [[ "${os_family}" == apt ]]; then
    packages=(ca-certificates curl openssl python3 tar coreutils util-linux iproute2 tzdata)
    for package in "${packages[@]}"; do dpkg-query -W -f='${db:Status-Abbrev}' "${package}" 2>/dev/null | grep -q '^ii ' || missing+=("${package}"); done
    if [[ "${#missing[@]}" -gt 0 ]]; then
      apt-get update
      DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends "${missing[@]}" </dev/null
    fi
  elif [[ "${os_family}" == dnf ]]; then
    packages=(ca-certificates curl openssl python3 tar coreutils util-linux iproute tzdata)
    for package in "${packages[@]}"; do rpm -q "${package}" >/dev/null 2>&1 || missing+=("${package}"); done
    [[ "${#missing[@]}" -eq 0 ]] || dnf install --assumeyes "${missing[@]}" </dev/null
  else
    fail "不支持在${os_id}上安装基础软件"
  fi
}

install_apt_docker_repo() {
  local repository_url key_url key_temp source_temp source_path=/etc/apt/sources.list.d/docker.sources
  repository_url="https://download.docker.com/linux/${os_id}"
  key_url="${repository_url}/gpg"
  [[ -n "${os_codename}" ]] || fail "系统未提供VERSION_CODENAME"
  install -d -m 0755 /etc/apt/keyrings
  key_temp="$(mktemp)"; source_temp="$(mktemp)"
  curl --fail --silent --show-error --location "${key_url}" --output "${key_temp}"
  [[ -s "${key_temp}" ]] || fail "Docker仓库公钥为空"
  if [[ -e /etc/apt/keyrings/docker.asc ]]; then
    cmp -s "${key_temp}" /etc/apt/keyrings/docker.asc || fail "已有Docker仓库公钥与当前官方源不一致，拒绝覆盖"
  else
    install -m 0644 "${key_temp}" /etc/apt/keyrings/docker.asc
  fi
  printf 'Types: deb\nURIs: %s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' \
    "${repository_url}" "${os_codename}" "$(dpkg --print-architecture)" > "${source_temp}"
  if [[ -e "${source_path}" ]]; then
    cmp -s "${source_temp}" "${source_path}" || fail "已有${source_path}与目标Docker官方源不一致，拒绝覆盖"
  else
    install -m 0644 "${source_temp}" "${source_path}"
  fi
  rm -f -- "${key_temp}" "${source_temp}"
  apt-get update
}

install_dnf_docker_repo() {
  local repository_url repository_temp repository_path=/etc/yum.repos.d/docker-ce.repo
  if [[ "${os_id}" == rhel ]]; then repository_url=https://download.docker.com/linux/rhel/docker-ce.repo
  else repository_url=https://download.docker.com/linux/centos/docker-ce.repo; fi
  repository_temp="$(mktemp)"
  curl --fail --silent --show-error --location "${repository_url}" --output "${repository_temp}"
  [[ -s "${repository_temp}" ]] || fail "Docker仓库文件为空"
  if [[ -e "${repository_path}" ]]; then
    cmp -s "${repository_temp}" "${repository_path}" || fail "已有Docker仓库配置与目标官方源不一致，拒绝覆盖"
  else
    install -m 0644 "${repository_temp}" "${repository_path}"
  fi
  rm -f -- "${repository_temp}"
  dnf makecache --assumeyes >/dev/null
}

install_docker() {
  local conflicts
  if [[ "${os_family}" == apt ]]; then
    conflicts="$(installed_deb_packages docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc | tr '\n' ' ')"
    [[ -z "${conflicts}" ]] || fail "发现可能冲突的既有软件包，拒绝自动移除：${conflicts}"
    [[ "${package_source}" == preconfigured ]] || install_apt_docker_repo
    DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin </dev/null
  elif [[ "${os_family}" == dnf ]]; then
    conflicts="$(installed_rpm_packages docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine podman-docker runc | tr '\n' ' ')"
    [[ -z "${conflicts}" ]] || fail "发现可能冲突的既有软件包，拒绝自动移除：${conflicts}"
    [[ "${package_source}" == preconfigured ]] || install_dnf_docker_repo
    dnf install --assumeyes docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin </dev/null
  else
    fail "不支持在${os_id}上安装Docker"
  fi
}

apply_host() {
  local conflicts=""
  [[ "${host_profile}" == managed-linux ]] || fail "existing-linux禁止修改宿主，请改用verify"
  [[ "${supported}" == yes && "${legacy_exception}" == no ]] || fail "当前宿主不允许自动安装"
  [[ "${systemd_available}" == true ]] || fail "自动安装要求systemd正在管理宿主"
  if [[ "${docker_cli_available}" == true && "${compose_available}" == false ]]; then
    fail "检测到既有Docker但缺少Compose，拒绝混用未知安装来源"
  fi
  if [[ "${docker_cli_available}" == false && -d /var/lib/docker ]] && find /var/lib/docker -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
    fail "存在非空/var/lib/docker但找不到Docker命令，拒绝接管"
  fi
  if [[ "${docker_cli_available}" == false ]]; then
    conflicts="$(detect_docker_conflicts | tr '\n' ' ')"
    [[ -z "${conflicts}" ]] || fail "发现可能冲突的既有软件包，拒绝自动移除：${conflicts}"
  fi

  install_base_packages
  if ! command_available docker; then install_docker; fi
  systemctl enable --now docker
  docker info >/dev/null 2>&1 || fail "Docker服务启动后仍不可用"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2不可用"
  if [[ "$(timedatectl show -p Timezone | sed -n 's/^Timezone=//p')" != "${timezone}" ]]; then timedatectl set-timezone "${timezone}"; fi

  install -d -m 0755 /var/lib/my-bill/operations
  state_temp="$(mktemp /var/lib/my-bill/operations/.host-bootstrap.XXXXXX)"
  printf 'hostProfile=%s\nos=%s:%s\narchitecture=%s\ndocker=%s\ncompose=%s\ntimezone=%s\npackageSource=%s\nupdatedAt=%s\n' \
    "${host_profile}" "${os_id}" "${os_version}" "${architecture}" \
    "$(docker version --format '{{.Server.Version}}')" "$(docker compose version --short)" \
    "${timezone}" "${package_source}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "${state_temp}"
  chmod 0600 "${state_temp}"
  mv -f "${state_temp}" /var/lib/my-bill/operations/host-bootstrap.properties
  exec bash "$0" --action verify --host-profile "${host_profile}" --package-source "${package_source}" \
    --timezone "${timezone}" --firewall-mode "${firewall_mode}" --bind-ip "${bind_ip}" \
    --https-port "${https_port}" --allow-eol-centos7 "${allow_eol_centos7}" \
    --min-docker-version "${min_docker_version}" --min-compose-version "${min_compose_version}"
}

case "${action}" in
  inspect) print_facts ;;
  plan) print_plan ;;
  verify) print_facts; verify_host ;;
  apply) apply_host ;;
esac
