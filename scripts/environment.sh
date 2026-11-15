#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIRECTORY="${MY_BILL_DEPLOY_TARGET_DIRECTORY:-${PROJECT_ROOT}/.local/web/deploy-targets}"
TARGET_LIST="${TARGET_DIRECTORY}/targets.list"
RELEASE_DIRECTORY="${PROJECT_ROOT}/.local/web/releases"
SENSITIVE_TEMP_FILES=()

cleanup_sensitive_temps() {
  local path
  for path in "${SENSITIVE_TEMP_FILES[@]-}"; do
    [[ -z "${path}" || ! -e "${path}" ]] || rm -f -- "${path}"
  done
}
trap cleanup_sensitive_temps EXIT

usage() {
  cat <<'EOF'
用法：
  npm run environment -- configure [目标]
  npm run environment -- targets
  npm run environment -- inspect <目标...|--all>
  npm run environment -- host-plan <目标...|--all>
  npm run environment -- host-apply <目标...|--all> [--yes]
  npm run environment -- host-verify <目标...|--all>
  npm run environment -- plan <目标...|--all>
  npm run environment -- preflight <目标...|--all>
  npm run environment -- bootstrap <目标...|--all> [--yes]
  npm run environment -- resume <目标...|--all> [--yes]
  npm run environment -- verify <目标...|--all>
  npm run environment -- status <目标...|--all>
  npm run environment -- finalize <目标...|--all> [--yes]

configure 是交互式目标配置向导；其他命令读取 .local/web/deploy-targets/<目标>.env。
host-apply 从可SSH的受支持Linux开始安装缺失宿主组件；不会安装操作系统、创建云资源或修改外部网络。
bootstrap 在宿主验证通过后初始化全新项目环境。
EOF
}

fail() { echo "错误：$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || fail "缺少命令：$1"; }
source "${PROJECT_ROOT}/scripts/lib/deploy-target.sh"

prompt_value() {
  local label="$1" default_value="$2" answer
  if [[ -n "${default_value}" ]]; then
    read -r -p "${label} [${default_value}]: " answer </dev/tty
    printf '%s' "${answer:-${default_value}}"
  else
    while true; do
      read -r -p "${label}: " answer </dev/tty
      [[ -n "${answer}" ]] && { printf '%s' "${answer}"; return; }
      echo "该项不能为空。" >/dev/tty
    done
  fi
}

prompt_optional() {
  local label="$1" default_value="${2:-}" answer
  if [[ -n "${default_value}" ]]; then
    read -r -p "${label} [${default_value}]: " answer </dev/tty
    printf '%s' "${answer:-${default_value}}"
  else
    read -r -p "${label}: " answer </dev/tty
    printf '%s' "${answer}"
  fi
}

confirm() {
  local prompt="$1" default_yes="${2:-false}" answer suffix
  [[ "${ASSUME_YES:-false}" == true ]] && return 0
  [[ -r /dev/tty ]] || fail "当前操作需要确认；非交互执行请显式添加 --yes"
  if [[ "${default_yes}" == true ]]; then suffix='[Y/n]'; else suffix='[y/N]'; fi
  read -r -p "${prompt} ${suffix} " answer </dev/tty
  if [[ "${default_yes}" == true ]]; then [[ ! "${answer}" =~ ^[Nn]$ ]]; else [[ "${answer}" =~ ^[Yy]$ ]]; fi
}

validate_intranet_ipv4() {
  python3 - "$1" 2>/dev/null <<'PY'
import ipaddress,sys
a=ipaddress.ip_address(sys.argv[1])
private_networks=[ipaddress.ip_network(value) for value in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')]
assert a.version == 4 and any(a in network for network in private_networks), '必须是RFC1918内网IPv4'
PY
}

validate_cidrs() {
  python3 - "$1" 2>/dev/null <<'PY'
import ipaddress,sys
values=sys.argv[1].split()
assert values, '至少需要一个CIDR'
for value in values:
    ipaddress.ip_network(value, strict=False)
PY
}

load_deployment_profile() {
  local requested_profile="$1" profile_file
  local line key value
  profile_file="${PROJECT_ROOT}/deploy/profiles/${requested_profile}.env"
  [[ -f "${profile_file}" ]] || fail "找不到部署模式契约：${requested_profile}"
  PROFILE_ID=""; PROFILE_IMPLEMENTED=""; PROFILE_ENTRY_KIND=""; PROFILE_TLS_PROVIDER=""
  PROFILE_COMPOSE_OVERLAY=""; PROFILE_BLOCKED_BY=""
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == *=* ]] || fail "部署模式 ${requested_profile} 包含无效行"
    key="${line%%=*}"; value="${line#*=}"
    case "${key}" in
      PROFILE_ID) PROFILE_ID="${value}" ;;
      IMPLEMENTED) PROFILE_IMPLEMENTED="${value}" ;;
      ENTRY_KIND) PROFILE_ENTRY_KIND="${value}" ;;
      TLS_PROVIDER) PROFILE_TLS_PROVIDER="${value}" ;;
      COMPOSE_OVERLAY) PROFILE_COMPOSE_OVERLAY="${value}" ;;
      BLOCKED_BY) PROFILE_BLOCKED_BY="${value}" ;;
      *) fail "部署模式 ${requested_profile} 包含未知字段：${key}" ;;
    esac
  done < "${profile_file}"
  [[ "${PROFILE_ID}" == "${requested_profile}" ]] || fail "部署模式文件与 PROFILE_ID 不一致"
  [[ "${PROFILE_IMPLEMENTED}" == 0 || "${PROFILE_IMPLEMENTED}" == 1 ]] || fail "部署模式 ${requested_profile} 的 IMPLEMENTED 不合法"
}

load_host_profile() {
  local requested_profile="$1" profile_file line key value
  profile_file="${PROJECT_ROOT}/deploy/host-profiles/${requested_profile}.env"
  [[ -f "${profile_file}" ]] || fail "找不到宿主模式契约：${requested_profile}"
  HOST_PROFILE_ID=""; HOST_PROFILE_IMPLEMENTED=""; HOST_PROFILE_MUTATION_ALLOWED=""
  HOST_PROFILE_MIN_DOCKER_VERSION=""; HOST_PROFILE_MIN_COMPOSE_VERSION=""
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == *=* ]] || fail "宿主模式 ${requested_profile} 包含无效行"
    key="${line%%=*}"; value="${line#*=}"
    case "${key}" in
      HOST_PROFILE_ID) HOST_PROFILE_ID="${value}" ;;
      IMPLEMENTED) HOST_PROFILE_IMPLEMENTED="${value}" ;;
      MUTATION_ALLOWED) HOST_PROFILE_MUTATION_ALLOWED="${value}" ;;
      MIN_DOCKER_VERSION) HOST_PROFILE_MIN_DOCKER_VERSION="${value}" ;;
      MIN_COMPOSE_VERSION) HOST_PROFILE_MIN_COMPOSE_VERSION="${value}" ;;
      *) fail "宿主模式 ${requested_profile} 包含未知字段：${key}" ;;
    esac
  done < "${profile_file}"
  [[ "${HOST_PROFILE_ID}" == "${requested_profile}" ]] || fail "宿主模式文件与HOST_PROFILE_ID不一致"
  [[ "${HOST_PROFILE_IMPLEMENTED}" == 1 ]] || fail "宿主模式 ${requested_profile} 尚未实现"
  [[ "${HOST_PROFILE_MUTATION_ALLOWED}" == 0 || "${HOST_PROFILE_MUTATION_ALLOWED}" == 1 ]] || fail "宿主模式 ${requested_profile} 的MUTATION_ALLOWED不合法"
  [[ "${HOST_PROFILE_MIN_DOCKER_VERSION}" =~ ^[0-9]+([.][0-9]+){1,2}$ ]] || fail "宿主模式 ${requested_profile} 的Docker最低版本不合法"
  [[ "${HOST_PROFILE_MIN_COMPOSE_VERSION}" =~ ^[0-9]+([.][0-9]+){1,2}$ ]] || fail "宿主模式 ${requested_profile} 的Compose最低版本不合法"
}

configure_target() {
  require_command python3
  [[ -r /dev/tty ]] || fail "configure 需要交互式终端"
  local requested_id="${1:-}" target_id config_file profile_choice host_choice package_choice tls_choice generate_tls=false
  local host ssh_user ssh_port identity_file known_hosts bind_ip https_port allowed_cidrs
  local remote_root env_file ca_file health_url cert_source key_source ca_source admin_output offsite_backup offsite_key allow_eol=0
  local host_profile package_source pki_root leaf_root temporary backup_file

  echo "我的账单首次环境安装向导"
  echo "只采集非敏感参数与密钥文件路径；不会要求在终端输入生产密码。"
  target_id="$(prompt_value '目标ID（字母、数字、点、下划线、横线）' "${requested_id}")"
  validate_target_id "${target_id}"
  config_file="${TARGET_DIRECTORY}/${target_id}.env"
  if [[ -e "${config_file}" ]]; then
    confirm "目标配置已存在，是否备份后重新配置？" false || fail "已取消"
    backup_file="${config_file}.bak.$(date '+%Y%m%d-%H%M%S')"
    cp "${config_file}" "${backup_file}"
    chmod 0600 "${backup_file}"
    echo "旧配置已备份到 ${backup_file}"
  fi

  while true; do
    cat >/dev/tty <<'EOF'
部署模式：
  1) intranet-single-host（当前已实现）
  2) public-direct（仅预留，尚未实现）
  3) public-behind-edge（仅预留，尚未实现）
EOF
    read -r -p '请选择 [1]: ' profile_choice </dev/tty
    case "${profile_choice:-1}" in
      1) break ;;
      2|3) echo "公网模式必须先完成域名、TLS、真实客户端IP和管理入口方案，当前拒绝生成伪可用配置。" >/dev/tty ;;
      *) echo "请输入1、2或3。" >/dev/tty ;;
    esac
  done

  host="$(prompt_value 'SSH主机名或IPv4' '')"
  ssh_user="$(prompt_value 'SSH用户（当前安装与初始化要求root）' 'root')"
  [[ "${ssh_user}" == root ]] || fail "当前环境安装与初始化只支持root SSH；不隐式使用sudo"
  ssh_port="$(prompt_value 'SSH端口' '22')"
  identity_file="$(prompt_optional 'SSH私钥绝对路径（留空使用ssh-agent）')"
  known_hosts="$(prompt_value 'known_hosts绝对路径' "${HOME}/.ssh/known_hosts")"
  cat >/dev/tty <<'EOF'
宿主模式：
  1) managed-linux（新建/专用主机，安装缺失组件并启用Docker）
  2) existing-linux（共享/既有主机，只检查不修改）
EOF
  read -r -p '请选择 [1]: ' host_choice </dev/tty
  case "${host_choice:-1}" in
    1) host_profile=managed-linux ;;
    2) host_profile=existing-linux ;;
    *) fail "宿主模式选项不合法" ;;
  esac
  package_source=preconfigured
  if [[ "${host_profile}" == managed-linux ]]; then
    cat >/dev/tty <<'EOF'
Docker软件源：
  1) 使用宿主已配置的软件源/组织镜像（推荐内网）
  2) 配置Docker官方稳定源（要求目标机可访问download.docker.com）
EOF
    read -r -p '请选择 [1]: ' package_choice </dev/tty
    case "${package_choice:-1}" in
      1) package_source=preconfigured ;;
      2) package_source=docker-official ;;
      *) fail "软件源选项不合法" ;;
    esac
  fi
  bind_ip="$(prompt_value '服务绑定的RFC1918内网IPv4' "${host}")"
  validate_intranet_ipv4 "${bind_ip}" || fail "内网IP不合法：${bind_ip}"
  https_port="$(prompt_value 'HTTPS端口' '18443')"
  [[ "${https_port}" =~ ^[0-9]+$ && "${https_port}" -ge 1024 && "${https_port}" -le 65535 ]] || fail "HTTPS端口不合法"
  allowed_cidrs="$(prompt_value '允许访问的CIDR（空格分隔，必须明确填写）' '')"
  validate_cidrs "${allowed_cidrs}" || fail "允许网段不合法：${allowed_cidrs}"
  remote_root="$(prompt_value '服务器发布根目录（当前实现固定）' '/opt/my-bill')"
  env_file="$(prompt_value '服务器运行配置路径（当前实现固定）' '/etc/my-bill/production.env')"
  ca_file="$(prompt_value '服务器CA公钥路径（当前实现固定）' '/etc/my-bill/ca.crt')"
  [[ "${remote_root}" == /opt/my-bill && "${env_file}" == /etc/my-bill/production.env && "${ca_file}" == /etc/my-bill/ca.crt ]] || fail "当前初始化实现只支持向导显示的固定服务器路径"
  health_url="$(prompt_value 'HTTPS健康地址' "https://${bind_ip}:${https_port}/api/v1/health")"
  admin_output="$(prompt_value '本机初始管理员凭据输出文件' "${PROJECT_ROOT}/.local/web/deployment/${target_id}-initial-admin.json")"
  offsite_backup="$(prompt_value '异机加密备份目录' "${PROJECT_ROOT}/.local/web/offsite-backups/${target_id}")"
  offsite_key="$(prompt_value '备份解密材料暂存目录（应继续转存组织密钥库）' "${PROJECT_ROOT}/.local/web/backup-keys/${target_id}")"
  validate_absolute_path BILL_OFFSITE_BACKUP_DIRECTORY "${offsite_backup}"
  validate_absolute_path BILL_OFFSITE_KEY_DIRECTORY "${offsite_key}"
  [[ "${offsite_backup}" != / && "${offsite_backup}" != "${HOME}" && "$(dirname "${offsite_backup}")" != / && "${offsite_key}" != / && "${offsite_key}" != "${HOME}" && "$(dirname "${offsite_key}")" != / ]] || fail "异机落点不能是顶层目录或用户主目录"
  [[ "${offsite_backup}" != "${offsite_key}" ]] || fail "异机备份和解密材料目录不能相同"

  cat >/dev/tty <<'EOF'
TLS材料：
  1) 使用已有的服务器叶证书、叶私钥和CA公钥
  2) 为该环境新建独立内部CA并签发叶证书
EOF
  read -r -p '请选择 [1]: ' tls_choice </dev/tty
  case "${tls_choice:-1}" in
    1)
      cert_source="$(prompt_value 'server.crt绝对路径' '')"
      key_source="$(prompt_value 'server.key绝对路径' '')"
      ca_source="$(prompt_value 'ca.crt绝对路径' '')"
      ;;
    2)
      generate_tls=true
      pki_root="$(prompt_value '本机PKI保管目录' "${PROJECT_ROOT}/.local/web/pki/${target_id}")"
      [[ ! -e "${pki_root}" ]] || fail "PKI目录已存在，拒绝覆盖：${pki_root}"
      leaf_root="${pki_root}/issued-${bind_ip}"
      cert_source="${leaf_root}/server.crt"
      key_source="${leaf_root}/server.key"
      ca_source="${pki_root}/ca/ca.crt"
      ;;
    *) fail "TLS选项不合法" ;;
  esac

  if [[ "${host_profile}" == existing-linux && "${bind_ip}" == 10.100.101.104 ]] && confirm "是否启用仅限既有10.100.101.104主机的CentOS7已批准例外？" false; then
    allow_eol=1
  fi

  cat >/dev/tty <<EOF

即将保存（不含密码/私钥正文）：
  目标：${target_id}
  模式：intranet-single-host
  宿主：${host_profile}（软件源：${package_source}）
  SSH：${ssh_user}@${host}:${ssh_port}
  入口：https://${bind_ip}:${https_port}
  允许网段：${allowed_cidrs}
  发布根：${remote_root}
  TLS证书：${cert_source}
  初始管理员凭据：${admin_output}
  异机备份：${offsite_backup}
  解密材料暂存：${offsite_key}
EOF
  confirm "确认生成目标配置？" false || fail "已取消"

  [[ -f "${known_hosts}" ]] || fail "文件不存在：${known_hosts}"
  [[ -z "${identity_file}" || -f "${identity_file}" ]] || fail "SSH私钥不存在：${identity_file}"
  if [[ "${generate_tls}" == true ]]; then
    bash "${PROJECT_ROOT}/deploy/tls/internal-ca.sh" init "${pki_root}/ca"
    bash "${PROJECT_ROOT}/deploy/tls/internal-ca.sh" issue "${pki_root}/ca" "${bind_ip}" "${leaf_root}"
    echo "CA私钥仅保存在 ${pki_root}/ca/ca.key；不会上传服务器。"
  fi
  for path in "${cert_source}" "${key_source}" "${ca_source}"; do [[ -f "${path}" ]] || fail "文件不存在：${path}"; done

  mkdir -p "${TARGET_DIRECTORY}"
  temporary="$(mktemp "${TARGET_DIRECTORY}/.${target_id}.XXXXXX")"
  umask 077
  {
    echo "BILL_TARGET_ID=${target_id}"
    echo "BILL_DEPLOYMENT_PROFILE=intranet-single-host"
    echo "BILL_HOST_PROFILE=${host_profile}"
    echo "BILL_HOST_PACKAGE_SOURCE=${package_source}"
    echo "BILL_HOST_TIMEZONE=Asia/Shanghai"
    echo "BILL_HOST_FIREWALL_MODE=external"
    echo "BILL_HOST=${host}"
    echo "BILL_SSH_USER=${ssh_user}"
    echo "BILL_SSH_PORT=${ssh_port}"
    echo "BILL_IDENTITY_FILE=${identity_file}"
    echo "BILL_KNOWN_HOSTS_FILE=${known_hosts}"
    echo "BILL_REMOTE_ROOT=${remote_root}"
    echo "BILL_ENV_FILE=${env_file}"
    echo "BILL_CA_FILE=${ca_file}"
    echo "BILL_HEALTH_URL=${health_url}"
    echo "BILL_BACKUP_SERVICE=my-bill-backup.service"
    echo "BILL_BACKUP_STATUS_FILE=/var/lib/my-bill/operations/backup.properties"
    echo "BILL_OFFSITE_BACKUP_DIRECTORY=${offsite_backup}"
    echo "BILL_OFFSITE_KEY_DIRECTORY=${offsite_key}"
    echo "BILL_COMPOSE_OVERLAY=deploy/compose.intranet.yaml"
    echo "BILL_HEALTH_TIMEOUT_SECONDS=180"
    echo "BILL_BIND_IP=${bind_ip}"
    echo "BILL_HTTPS_PORT=${https_port}"
    echo "BILL_ALLOWED_CIDRS=${allowed_cidrs}"
    echo "BILL_TLS_CERT_SOURCE=${cert_source}"
    echo "BILL_TLS_KEY_SOURCE=${key_source}"
    echo "BILL_CA_CERT_SOURCE=${ca_source}"
    echo "BILL_INITIAL_ADMIN_OUTPUT_FILE=${admin_output}"
    echo "BILL_ALLOW_EOL_CENTOS7=${allow_eol}"
  } > "${temporary}"
  chmod 0600 "${temporary}"
  mv "${temporary}" "${config_file}"
  load_target "${target_id}"
  validate_environment_target

  if confirm "是否把 ${target_id} 加入 --all 的执行顺序？" true; then
    touch "${TARGET_LIST}"; chmod 0600 "${TARGET_LIST}"
    grep -Fqx "${target_id}" "${TARGET_LIST}" || printf '%s\n' "${target_id}" >> "${TARGET_LIST}"
  fi
  echo "配置完成：${config_file}"
  echo "下一步：npm run environment -- inspect ${target_id}"
}

validate_host_target() {
  require_command python3
  load_host_profile "${BILL_HOST_PROFILE}"
  [[ "${BILL_SSH_USER}" == root ]] || fail "${BILL_TARGET_ID} 的宿主安装与项目初始化当前要求root SSH"
  validate_intranet_ipv4 "${BILL_BIND_IP}" || fail "${BILL_TARGET_ID} 的内网IP不合法"
  [[ "${BILL_HTTPS_PORT}" =~ ^[0-9]+$ && "${BILL_HTTPS_PORT}" -ge 1024 && "${BILL_HTTPS_PORT}" -le 65535 ]] || fail "${BILL_TARGET_ID} 的HTTPS端口不合法"
  [[ "${BILL_HOST_FIREWALL_MODE}" == external ]] || fail "${BILL_TARGET_ID} 的宿主防火墙模式尚未实现"
  if [[ "${BILL_ALLOW_EOL_CENTOS7}" == 1 && "${BILL_HOST_PROFILE}" != existing-linux ]]; then
    fail "${BILL_TARGET_ID} 的CentOS7例外只能使用existing-linux"
  fi
}

validate_environment_target() {
  local path cert_public key_public
  validate_host_target
  require_command python3
  require_command openssl
  load_deployment_profile "${BILL_DEPLOYMENT_PROFILE}"
  [[ "${PROFILE_IMPLEMENTED}" == 1 ]] || fail "${BILL_TARGET_ID} 的模式 ${BILL_DEPLOYMENT_PROFILE} 尚未实现（阻塞项：${PROFILE_BLOCKED_BY:-未登记}）"
  [[ "${BILL_DEPLOYMENT_PROFILE}" == intranet-single-host ]] || fail "${BILL_TARGET_ID} 的模式 ${BILL_DEPLOYMENT_PROFILE} 尚无目标端执行器"
  [[ -n "${BILL_BIND_IP}" ]] || fail "${BILL_TARGET_ID} 缺少 BILL_BIND_IP；请运行 configure"
  validate_intranet_ipv4 "${BILL_BIND_IP}" || fail "${BILL_TARGET_ID} 的内网IP不合法"
  [[ "${BILL_HTTPS_PORT}" =~ ^[0-9]+$ && "${BILL_HTTPS_PORT}" -ge 1024 && "${BILL_HTTPS_PORT}" -le 65535 ]] || fail "${BILL_TARGET_ID} 的HTTPS端口不合法"
  [[ -n "${BILL_ALLOWED_CIDRS}" && "${BILL_ALLOWED_CIDRS}" != *$'\n'* ]] || fail "${BILL_TARGET_ID} 缺少允许网段"
  validate_cidrs "${BILL_ALLOWED_CIDRS}" || fail "${BILL_TARGET_ID} 的允许网段不合法"
  for path in "${BILL_TLS_CERT_SOURCE}" "${BILL_TLS_KEY_SOURCE}" "${BILL_CA_CERT_SOURCE}"; do validate_absolute_path TLS_SOURCE "${path}"; [[ -f "${path}" ]] || fail "${BILL_TARGET_ID} 的TLS文件不存在：${path}"; done
  openssl verify -CAfile "${BILL_CA_CERT_SOURCE}" -verify_ip "${BILL_BIND_IP}" "${BILL_TLS_CERT_SOURCE}" >/dev/null || fail "${BILL_TARGET_ID} 的叶证书不受指定CA信任或不匹配绑定IP"
  openssl x509 -in "${BILL_TLS_CERT_SOURCE}" -checkend 86400 -noout >/dev/null || fail "${BILL_TARGET_ID} 的叶证书无效或将在24小时内到期"
  cert_public="$(openssl x509 -in "${BILL_TLS_CERT_SOURCE}" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $2}')"
  key_public="$(openssl pkey -in "${BILL_TLS_KEY_SOURCE}" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $2}')"
  [[ -n "${cert_public}" && "${cert_public}" == "${key_public}" ]] || fail "${BILL_TARGET_ID} 的叶证书与私钥不匹配"
  validate_absolute_path BILL_INITIAL_ADMIN_OUTPUT_FILE "${BILL_INITIAL_ADMIN_OUTPUT_FILE}"
  [[ "${BILL_HEALTH_URL}" == "https://${BILL_BIND_IP}:${BILL_HTTPS_PORT}/api/v1/health" ]] || fail "${BILL_TARGET_ID} 的健康地址必须是当前绑定IP和端口的 /api/v1/health"
  [[ "${BILL_REMOTE_ROOT}" == /opt/my-bill ]] || fail "${BILL_TARGET_ID} 的首次初始化发布根当前必须是 /opt/my-bill"
  [[ "${BILL_ENV_FILE}" == /etc/my-bill/production.env ]] || fail "${BILL_TARGET_ID} 的首次初始化运行配置当前必须是 /etc/my-bill/production.env"
  [[ "${BILL_CA_FILE}" == /etc/my-bill/ca.crt ]] || fail "${BILL_TARGET_ID} 的首次初始化CA路径当前必须是 /etc/my-bill/ca.crt"
  [[ "${BILL_BACKUP_SERVICE}" == my-bill-backup.service && "${BILL_BACKUP_STATUS_FILE}" == /var/lib/my-bill/operations/backup.properties ]] || fail "${BILL_TARGET_ID} 的首次初始化备份单元必须使用当前固定契约"
  [[ "${BILL_COMPOSE_OVERLAY}" == "${PROFILE_COMPOSE_OVERLAY}" ]] || fail "${BILL_TARGET_ID} 的Compose覆盖与部署模式契约不一致"
}

host_remote_command() {
  local action="$1" destination="$2" remote_script="$3" remote_command
  printf -v remote_command 'LC_ALL=C LANG=C bash %q --action %q --host-profile %q --package-source %q --timezone %q --firewall-mode %q --bind-ip %q --https-port %q --allow-eol-centos7 %q --min-docker-version %q --min-compose-version %q' \
    "${remote_script}" "${action}" "${BILL_HOST_PROFILE}" "${BILL_HOST_PACKAGE_SOURCE}" "${BILL_HOST_TIMEZONE}" \
    "${BILL_HOST_FIREWALL_MODE}" "${BILL_BIND_IP}" "${BILL_HTTPS_PORT}" "${BILL_ALLOW_EOL_CENTOS7}" \
    "${HOST_PROFILE_MIN_DOCKER_VERSION}" "${HOST_PROFILE_MIN_COMPOSE_VERSION}"
  ssh "${SSH_ARGS[@]}" "${destination}" "${remote_command}"
}

run_host_action() {
  local action="$1" target="$2" destination remote_script temporary_script remote_command
  load_target "${target}"; validate_host_target; validate_local_connection_files; ssh_arguments
  destination="${BILL_SSH_USER}@${BILL_HOST}"
  remote_script=-
  if [[ "${action}" == apply ]]; then
    [[ "${HOST_PROFILE_MUTATION_ALLOWED}" == 1 ]] || fail "${target} 使用existing-linux，禁止host-apply"
    temporary_script="/tmp/my-bill-prepare-host-${BILL_TARGET_ID}-$$.sh"
    scp "${SCP_ARGS[@]}" "${PROJECT_ROOT}/deploy/scripts/prepare-host.sh" "${destination}:${temporary_script}"
    remote_script="${temporary_script}"
    if host_remote_command "${action}" "${destination}" "${remote_script}"; then
      ssh "${SSH_ARGS[@]}" "${destination}" "rm -f $(printf '%q' "${temporary_script}")"
    else
      ssh "${SSH_ARGS[@]}" "${destination}" "rm -f $(printf '%q' "${temporary_script}")" || true
      return 1
    fi
  else
    printf -v remote_command 'LC_ALL=C LANG=C bash -s -- --action %q --host-profile %q --package-source %q --timezone %q --firewall-mode %q --bind-ip %q --https-port %q --allow-eol-centos7 %q --min-docker-version %q --min-compose-version %q' \
      "${action}" "${BILL_HOST_PROFILE}" "${BILL_HOST_PACKAGE_SOURCE}" "${BILL_HOST_TIMEZONE}" \
      "${BILL_HOST_FIREWALL_MODE}" "${BILL_BIND_IP}" "${BILL_HTTPS_PORT}" "${BILL_ALLOW_EOL_CENTOS7}" \
      "${HOST_PROFILE_MIN_DOCKER_VERSION}" "${HOST_PROFILE_MIN_COMPOSE_VERSION}"
    ssh "${SSH_ARGS[@]}" "${destination}" "${remote_command}" < "${PROJECT_ROOT}/deploy/scripts/prepare-host.sh"
  fi
}

print_plan() {
  local target="$1"; load_target "${target}"; validate_environment_target
  cat <<EOF
目标：${BILL_TARGET_ID}
  模式：${BILL_DEPLOYMENT_PROFILE}
  SSH：${BILL_SSH_USER}@${BILL_HOST}:${BILL_SSH_PORT}
  HTTPS：${BILL_HEALTH_URL}
  允许网段：${BILL_ALLOWED_CIDRS}
  发布根：${BILL_REMOTE_ROOT}
  运行配置：${BILL_ENV_FILE}
  TLS：已有材料受控上传（CA私钥不上传）
  初始管理员凭据：${BILL_INITIAL_ADMIN_OUTPUT_FILE}（0600，不回显）
  初始化：预检→候选→secret→TLS→镜像→db→角色→迁移→管理员→app/proxy→备份/巡检→验收
EOF
}

preflight_target() {
  local target="$1" destination
  load_target "${target}"; validate_environment_target; validate_local_connection_files; ssh_arguments
  destination="${BILL_SSH_USER}@${BILL_HOST}"
  echo "[${target}] 只读主机预检"
  ssh "${SSH_ARGS[@]}" "${destination}" "MY_BILL_ALLOW_EOL_CENTOS7=${BILL_ALLOW_EOL_CENTOS7} bash -s -- $(printf '%q' "${BILL_BIND_IP}") $(printf '%q' "${BILL_HTTPS_PORT}")" < "${PROJECT_ROOT}/deploy/scripts/preflight-host.sh"
}

remote_tool_command() {
  local action="$1" destination="$2" remote_script="$3" remote_log_helper="$4" remote_command
  printf -v remote_command 'bash %q --action %q --commit %q --incoming-dir %q --release-root %q --env-file %q --ca-file %q --health-url %q --compose-overlay %q --profile %q --bind-ip %q --https-port %q --allowed-cidrs %q --health-timeout %q --allow-eol-centos7 %q' \
    "${remote_script}" "${action}" "${REMOTE_COMMIT}" "${BILL_REMOTE_ROOT}/incoming/${REMOTE_COMMIT}" "${BILL_REMOTE_ROOT}" \
    "${BILL_ENV_FILE}" "${BILL_CA_FILE}" "${BILL_HEALTH_URL}" "${BILL_COMPOSE_OVERLAY}" "${BILL_DEPLOYMENT_PROFILE}" \
    "${BILL_BIND_IP}" "${BILL_HTTPS_PORT}" "${BILL_ALLOWED_CIDRS}" "${BILL_HEALTH_TIMEOUT_SECONDS}" "${BILL_ALLOW_EOL_CENTOS7}"
  remote_command+=" $(printf '%s %q %s %q %s %q %s %q' --log-helper "${remote_log_helper}" --log-archive-directory "${BILL_LOG_ARCHIVE_DIRECTORY}" --log-archive-days "${BILL_LOG_ARCHIVE_DAYS}" --log-archive-total-mb "${BILL_LOG_ARCHIVE_TOTAL_MB}")"
  ssh "${SSH_ARGS[@]}" "${destination}" "${remote_command}"
}

read_remote_commit() {
  local destination="$1"
  ssh "${SSH_ARGS[@]}" "${destination}" "awk -F= '\$1 == \"commit\" {print \$2}' /var/lib/my-bill/operations/environment-bootstrap.properties 2>/dev/null || true"
}

run_environment_action() {
  local action="$1" target="$2" destination artifact remote_incoming remote_script remote_log_helper temporary_script credential_temp credential_password_temp local_commit
  load_target "${target}"; validate_environment_target; validate_local_connection_files; ssh_arguments
  destination="${BILL_SSH_USER}@${BILL_HOST}"
  local_commit="$(git -C "${PROJECT_ROOT}" rev-parse HEAD)"
  REMOTE_COMMIT="${local_commit}"

  if [[ "${action}" == resume ]]; then
    state_commit="$(read_remote_commit "${destination}")"
    [[ -n "${state_commit}" ]] || fail "${target} 没有可续跑状态"
    [[ "${state_commit}" == "${local_commit}" ]] || fail "${target} 需续跑 ${state_commit}，本地HEAD为 ${local_commit}；请切换到原提交"
  elif [[ "${action}" != bootstrap ]]; then
    REMOTE_COMMIT="$(read_remote_commit "${destination}")"
    [[ -n "${REMOTE_COMMIT}" ]] || fail "${target} 没有初始化状态"
  fi

  if [[ "${action}" == bootstrap || "${action}" == resume ]]; then
    if [[ "${action}" == bootstrap && -e "${BILL_INITIAL_ADMIN_OUTPUT_FILE}" ]]; then
      fail "${target} 的本机初始管理员凭据文件已存在，拒绝开始新环境：${BILL_INITIAL_ADMIN_OUTPUT_FILE}"
    fi
    bash "${PROJECT_ROOT}/scripts/release.sh" build
    artifact="${RELEASE_DIRECTORY}/${REMOTE_COMMIT}"
    [[ -f "${artifact}/SHA256SUMS" ]] || fail "持续构建未生成候选 ${REMOTE_COMMIT}"
    (cd "${artifact}" && LC_ALL=C LANG=C shasum -a 256 -c SHA256SUMS >/dev/null)
    remote_incoming="${BILL_REMOTE_ROOT}/incoming/${REMOTE_COMMIT}"
    ssh "${SSH_ARGS[@]}" "${destination}" "install -d -m 0750 $(printf '%q' "${BILL_REMOTE_ROOT}") $(printf '%q' "${remote_incoming}") $(printf '%q' "${remote_incoming}/tls")"
    scp "${SCP_ARGS[@]}" \
      "${artifact}/source.tar" "${artifact}/web-dist.tar.gz" "${artifact}/manifest.txt" \
      "${artifact}/log-archive.sh" "${artifact}/apply-release.sh" "${artifact}/bootstrap-environment.sh" "${artifact}/preflight-host.sh" \
      "${artifact}/build.properties" "${artifact}/SHA256SUMS" "${destination}:${remote_incoming}/"
    scp "${SCP_ARGS[@]}" "${BILL_TLS_CERT_SOURCE}" "${destination}:${remote_incoming}/tls/server.crt"
    scp "${SCP_ARGS[@]}" "${BILL_TLS_KEY_SOURCE}" "${destination}:${remote_incoming}/tls/server.key"
    scp "${SCP_ARGS[@]}" "${BILL_CA_CERT_SOURCE}" "${destination}:${remote_incoming}/tls/ca.crt"
    ssh "${SSH_ARGS[@]}" "${destination}" "chmod 0600 $(printf '%q' "${remote_incoming}/tls/server.key")"
    remote_script="${remote_incoming}/bootstrap-environment.sh"
    remote_log_helper="${remote_incoming}/log-archive.sh"
  else
    temporary_script="/tmp/my-bill-environment-${BILL_TARGET_ID}-$$.sh"
    scp "${SCP_ARGS[@]}" "${PROJECT_ROOT}/deploy/scripts/bootstrap-environment.sh" "${destination}:${temporary_script}"
    remote_script="${temporary_script}"
    remote_log_helper="${temporary_script}.log-archive.sh"
    scp "${SCP_ARGS[@]}" "${PROJECT_ROOT}/deploy/scripts/log-archive.sh" "${destination}:${remote_log_helper}"
  fi

  if remote_tool_command "${action}" "${destination}" "${remote_script}" "${remote_log_helper}"; then
    if [[ "${action}" != bootstrap && "${action}" != resume ]]; then
      ssh "${SSH_ARGS[@]}" "${destination}" "rm -f $(printf '%q' "${temporary_script}") $(printf '%q' "${remote_log_helper:-${temporary_script}.log-archive.sh}")"
    fi
  else
    [[ -z "${temporary_script:-}" ]] || ssh "${SSH_ARGS[@]}" "${destination}" "rm -f $(printf '%q' "${temporary_script}") $(printf '%q' "${remote_log_helper:-${temporary_script}.log-archive.sh}")" || true
    return 1
  fi

  if [[ "${action}" == bootstrap || "${action}" == resume ]]; then
    if [[ ! -e "${BILL_INITIAL_ADMIN_OUTPUT_FILE}" ]]; then
      require_command python3
      mkdir -p "$(dirname "${BILL_INITIAL_ADMIN_OUTPUT_FILE}")"
      credential_temp="$(mktemp "$(dirname "${BILL_INITIAL_ADMIN_OUTPUT_FILE}")/.initial-admin.XXXXXX")"
      credential_password_temp="${credential_temp}.password"
      SENSITIVE_TEMP_FILES+=("${credential_temp}" "${credential_password_temp}")
      scp "${SCP_ARGS[@]}" "${destination}:/etc/my-bill/secrets/initial_admin_password" "${credential_password_temp}"
      python3 - "${credential_password_temp}" "${credential_temp}" "${BILL_TARGET_ID}" <<'PY'
import json,pathlib,sys
password_path,output_path,target=sys.argv[1:]
password=pathlib.Path(password_path).read_text().rstrip("\r\n")
pathlib.Path(output_path).write_text(json.dumps({"username":"admin","password":password,"target":target},ensure_ascii=False)+"\n")
PY
      rm "${credential_password_temp}"
      chmod 0600 "${credential_temp}"; mv "${credential_temp}" "${BILL_INITIAL_ADMIN_OUTPUT_FILE}"
      echo "[${target}] 初始管理员凭据已保存到 ${BILL_INITIAL_ADMIN_OUTPUT_FILE}（未回显）"
    else
      echo "[${target}] 本机凭据文件已存在，未覆盖：${BILL_INITIAL_ADMIN_OUTPUT_FILE}"
    fi
  fi
}

list_targets() {
  [[ -d "${TARGET_DIRECTORY}" ]] || { echo "尚未创建目标目录：${TARGET_DIRECTORY}"; return; }
  local file id
  for file in "${TARGET_DIRECTORY}"/*.env; do
    [[ -e "${file}" ]] || continue
    id="$(basename "${file}" .env)"; load_target "${id}"
    printf '%s\t%s\t%s@%s:%s\n' "${id}" "${BILL_DEPLOYMENT_PROFILE}" "${BILL_SSH_USER}" "${BILL_HOST}" "${BILL_SSH_PORT}"
  done
}

main() {
  local action="${1:-}"; [[ -n "${action}" ]] || { usage; exit 1; }; shift || true
  ASSUME_YES=false
  if [[ "${*: -1}" == --yes ]]; then ASSUME_YES=true; set -- "${@:1:$(($#-1))}"; fi
  case "${action}" in
    configure) [[ "$#" -le 1 ]] || fail "configure最多接受一个目标ID"; configure_target "${1:-}" ;;
    targets) [[ "$#" -eq 0 ]] || fail "targets不接受参数"; list_targets ;;
    inspect|host-plan|host-apply|host-verify|plan|preflight|bootstrap|resume|verify|status|finalize)
      resolve_targets "$@"
      if [[ "${action}" == host-apply || "${action}" == bootstrap || "${action}" == resume || "${action}" == finalize ]]; then
        confirm "确认对 ${#SELECTED_TARGETS[@]} 个目标执行 ${action}？" false || fail "已取消"
      fi
      local target
      for target in "${SELECTED_TARGETS[@]}"; do
        case "${action}" in
          inspect) run_host_action inspect "${target}" ;;
          host-plan) run_host_action plan "${target}" ;;
          host-apply) run_host_action apply "${target}" ;;
          host-verify) run_host_action verify "${target}" ;;
          plan) print_plan "${target}" ;;
          preflight) preflight_target "${target}" ;;
          *) run_environment_action "${action}" "${target}" ;;
        esac
      done
      ;;
    -h|--help|help) usage ;;
    *) usage; fail "未知操作：${action}" ;;
  esac
}

main "$@"
