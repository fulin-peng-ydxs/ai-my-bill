#!/usr/bin/env bash

# 由 release.sh 与 environment.sh 共用。配置按字面 KEY=value 解析，禁止 source，
# 避免本机目标文件中的命令替换或 shell 语法被执行。

validate_target_id() {
  [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || fail "目标名称不合法：$1"
}

reset_target() {
  BILL_TARGET_ID=""
  BILL_DEPLOYMENT_PROFILE="intranet-single-host"
  BILL_HOST_PROFILE="existing-linux"
  BILL_HOST_PACKAGE_SOURCE="preconfigured"
  BILL_HOST_TIMEZONE="Asia/Shanghai"
  BILL_HOST_FIREWALL_MODE="external"
  BILL_HOST=""
  BILL_SSH_USER="root"
  BILL_SSH_PORT="22"
  BILL_IDENTITY_FILE=""
  BILL_KNOWN_HOSTS_FILE="${HOME}/.ssh/known_hosts"
  BILL_REMOTE_ROOT="/opt/my-bill"
  BILL_ENV_FILE="/etc/my-bill/production.env"
  BILL_CA_FILE="/etc/my-bill/ca.crt"
  BILL_HEALTH_URL=""
  BILL_BACKUP_SERVICE="my-bill-backup.service"
  BILL_BACKUP_STATUS_FILE="/var/lib/my-bill/operations/backup.properties"
  BILL_OFFSITE_BACKUP_DIRECTORY=""
  BILL_OFFSITE_KEY_DIRECTORY=""
  BILL_LOG_ARCHIVE_DIRECTORY=""
  BILL_LOG_ARCHIVE_DAYS="14"
  BILL_LOG_ARCHIVE_TOTAL_MB="500"
  BILL_COMPOSE_OVERLAY="deploy/compose.intranet.yaml"
  BILL_HEALTH_TIMEOUT_SECONDS="180"
  BILL_BIND_IP=""
  BILL_HTTPS_PORT="18443"
  BILL_ALLOWED_CIDRS=""
  BILL_TLS_CERT_SOURCE=""
  BILL_TLS_KEY_SOURCE=""
  BILL_CA_CERT_SOURCE=""
  BILL_INITIAL_ADMIN_OUTPUT_FILE=""
  BILL_ALLOW_EOL_CENTOS7="0"
}

assign_target_value() {
  local key="$1"
  local value="$2"
  case "${key}" in
    BILL_TARGET_ID) BILL_TARGET_ID="${value}" ;;
    BILL_DEPLOYMENT_PROFILE) BILL_DEPLOYMENT_PROFILE="${value}" ;;
    BILL_HOST_PROFILE) BILL_HOST_PROFILE="${value}" ;;
    BILL_HOST_PACKAGE_SOURCE) BILL_HOST_PACKAGE_SOURCE="${value}" ;;
    BILL_HOST_TIMEZONE) BILL_HOST_TIMEZONE="${value}" ;;
    BILL_HOST_FIREWALL_MODE) BILL_HOST_FIREWALL_MODE="${value}" ;;
    BILL_HOST) BILL_HOST="${value}" ;;
    BILL_SSH_USER) BILL_SSH_USER="${value}" ;;
    BILL_SSH_PORT) BILL_SSH_PORT="${value}" ;;
    BILL_IDENTITY_FILE) BILL_IDENTITY_FILE="${value}" ;;
    BILL_KNOWN_HOSTS_FILE) BILL_KNOWN_HOSTS_FILE="${value}" ;;
    BILL_REMOTE_ROOT) BILL_REMOTE_ROOT="${value}" ;;
    BILL_ENV_FILE) BILL_ENV_FILE="${value}" ;;
    BILL_CA_FILE) BILL_CA_FILE="${value}" ;;
    BILL_HEALTH_URL) BILL_HEALTH_URL="${value}" ;;
    BILL_BACKUP_SERVICE) BILL_BACKUP_SERVICE="${value}" ;;
    BILL_BACKUP_STATUS_FILE) BILL_BACKUP_STATUS_FILE="${value}" ;;
    BILL_OFFSITE_BACKUP_DIRECTORY) BILL_OFFSITE_BACKUP_DIRECTORY="${value}" ;;
    BILL_OFFSITE_KEY_DIRECTORY) BILL_OFFSITE_KEY_DIRECTORY="${value}" ;;
    BILL_LOG_ARCHIVE_DIRECTORY) BILL_LOG_ARCHIVE_DIRECTORY="${value}" ;;
    BILL_LOG_ARCHIVE_DAYS) BILL_LOG_ARCHIVE_DAYS="${value}" ;;
    BILL_LOG_ARCHIVE_TOTAL_MB) BILL_LOG_ARCHIVE_TOTAL_MB="${value}" ;;
    BILL_COMPOSE_OVERLAY) BILL_COMPOSE_OVERLAY="${value}" ;;
    BILL_HEALTH_TIMEOUT_SECONDS) BILL_HEALTH_TIMEOUT_SECONDS="${value}" ;;
    BILL_BIND_IP) BILL_BIND_IP="${value}" ;;
    BILL_HTTPS_PORT) BILL_HTTPS_PORT="${value}" ;;
    BILL_ALLOWED_CIDRS) BILL_ALLOWED_CIDRS="${value}" ;;
    BILL_TLS_CERT_SOURCE) BILL_TLS_CERT_SOURCE="${value}" ;;
    BILL_TLS_KEY_SOURCE) BILL_TLS_KEY_SOURCE="${value}" ;;
    BILL_CA_CERT_SOURCE) BILL_CA_CERT_SOURCE="${value}" ;;
    BILL_INITIAL_ADMIN_OUTPUT_FILE) BILL_INITIAL_ADMIN_OUTPUT_FILE="${value}" ;;
    BILL_ALLOW_EOL_CENTOS7) BILL_ALLOW_EOL_CENTOS7="${value}" ;;
    *) fail "目标配置包含未知字段：${key}" ;;
  esac
}

validate_absolute_path() {
  [[ "$2" == /* && "$2" != *$'\n'* ]] || fail "$1 必须是绝对路径"
}

load_target() {
  local requested_id="$1"
  local config_file="${TARGET_DIRECTORY}/${requested_id}.env"
  local line key value local_path

  validate_target_id "${requested_id}"
  [[ -f "${config_file}" ]] || fail "找不到目标配置：${config_file}"
  reset_target
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == *=* ]] || fail "${config_file} 存在无效行：${line}"
    key="${line%%=*}"
    value="${line#*=}"
    [[ "${key}" =~ ^[A-Z][A-Z0-9_]*$ ]] || fail "${config_file} 存在无效字段名：${key}"
    assign_target_value "${key}" "${value}"
  done < "${config_file}"

  [[ "${BILL_TARGET_ID}" == "${requested_id}" ]] || fail "${config_file} 的 BILL_TARGET_ID 必须等于 ${requested_id}"
  [[ "${BILL_DEPLOYMENT_PROFILE}" =~ ^[a-z][a-z0-9-]*$ ]] || fail "${requested_id} 的 BILL_DEPLOYMENT_PROFILE 不合法"
  [[ "${BILL_HOST_PROFILE}" =~ ^[a-z][a-z0-9-]*$ ]] || fail "${requested_id} 的 BILL_HOST_PROFILE 不合法"
  [[ "${BILL_HOST_PACKAGE_SOURCE}" == preconfigured || "${BILL_HOST_PACKAGE_SOURCE}" == docker-official ]] || fail "${requested_id} 的 BILL_HOST_PACKAGE_SOURCE 只能是 preconfigured 或 docker-official"
  [[ "${BILL_HOST_TIMEZONE}" =~ ^[A-Za-z0-9_+.-]+(/[A-Za-z0-9_+.-]+)+$ ]] || fail "${requested_id} 的 BILL_HOST_TIMEZONE 不合法"
  [[ "${BILL_HOST_FIREWALL_MODE}" == external ]] || fail "${requested_id} 的 BILL_HOST_FIREWALL_MODE 当前只能是 external"
  [[ "${BILL_HOST}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || fail "${requested_id} 的 BILL_HOST 不合法（当前支持主机名或 IPv4）"
  [[ "${BILL_SSH_USER}" =~ ^[a-zA-Z_][a-zA-Z0-9._-]*$ ]] || fail "${requested_id} 的 BILL_SSH_USER 不合法"
  [[ "${BILL_SSH_PORT}" =~ ^[0-9]+$ && "${BILL_SSH_PORT}" -ge 1 && "${BILL_SSH_PORT}" -le 65535 ]] || fail "${requested_id} 的 BILL_SSH_PORT 不合法"
  validate_absolute_path BILL_REMOTE_ROOT "${BILL_REMOTE_ROOT}"
  validate_absolute_path BILL_ENV_FILE "${BILL_ENV_FILE}"
  validate_absolute_path BILL_CA_FILE "${BILL_CA_FILE}"
  validate_absolute_path BILL_BACKUP_STATUS_FILE "${BILL_BACKUP_STATUS_FILE}"
  [[ -z "${BILL_OFFSITE_BACKUP_DIRECTORY}" ]] || validate_absolute_path BILL_OFFSITE_BACKUP_DIRECTORY "${BILL_OFFSITE_BACKUP_DIRECTORY}"
  [[ -z "${BILL_OFFSITE_KEY_DIRECTORY}" ]] || validate_absolute_path BILL_OFFSITE_KEY_DIRECTORY "${BILL_OFFSITE_KEY_DIRECTORY}"
  for local_path in "${BILL_OFFSITE_BACKUP_DIRECTORY}" "${BILL_OFFSITE_KEY_DIRECTORY}"; do
    [[ -z "${local_path}" || "${local_path}" != / && "${local_path}" != "${HOME}" && "$(dirname "${local_path}")" != / ]] || fail "${requested_id} 的异机落点不能是顶层目录或用户主目录"
  done
  [[ -z "${BILL_OFFSITE_BACKUP_DIRECTORY}" || -z "${BILL_OFFSITE_KEY_DIRECTORY}" || "${BILL_OFFSITE_BACKUP_DIRECTORY}" != "${BILL_OFFSITE_KEY_DIRECTORY}" ]] || fail "${requested_id} 的异机备份和解密材料目录不能相同"
  [[ -z "${BILL_LOG_ARCHIVE_DIRECTORY}" ]] || validate_absolute_path BILL_LOG_ARCHIVE_DIRECTORY "${BILL_LOG_ARCHIVE_DIRECTORY}"
  [[ "${BILL_LOG_ARCHIVE_DAYS}" =~ ^[1-9][0-9]{0,2}$ && "${BILL_LOG_ARCHIVE_DAYS}" -le 365 ]] || fail "日志保留期不合法"
  [[ "${BILL_LOG_ARCHIVE_TOTAL_MB}" =~ ^[1-9][0-9]{0,4}$ && "${BILL_LOG_ARCHIVE_TOTAL_MB}" -ge 100 && "${BILL_LOG_ARCHIVE_TOTAL_MB}" -le 10240 ]] || fail "日志归档容量不合法"
  validate_absolute_path BILL_KNOWN_HOSTS_FILE "${BILL_KNOWN_HOSTS_FILE}"
  [[ -z "${BILL_IDENTITY_FILE}" ]] || validate_absolute_path BILL_IDENTITY_FILE "${BILL_IDENTITY_FILE}"
  [[ "${BILL_HEALTH_URL}" == https://* && "${BILL_HEALTH_URL}" != *[$'\r\n\t ']* ]] || fail "${requested_id} 的 BILL_HEALTH_URL 必须是无空白的 https:// 地址"
  [[ "${BILL_COMPOSE_OVERLAY}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ && "${BILL_COMPOSE_OVERLAY}" != /* && "${BILL_COMPOSE_OVERLAY}" != *".."* ]] || fail "${requested_id} 的 BILL_COMPOSE_OVERLAY 不合法"
  [[ "${BILL_BACKUP_SERVICE}" =~ ^[a-zA-Z0-9@._-]+\.service$ ]] || fail "${requested_id} 的 BILL_BACKUP_SERVICE 不合法"
  [[ "${BILL_HEALTH_TIMEOUT_SECONDS}" =~ ^[0-9]+$ && "${BILL_HEALTH_TIMEOUT_SECONDS}" -ge 30 && "${BILL_HEALTH_TIMEOUT_SECONDS}" -le 900 ]] || fail "${requested_id} 的健康等待秒数必须在 30 到 900 之间"
  [[ "${BILL_ALLOW_EOL_CENTOS7}" == 0 || "${BILL_ALLOW_EOL_CENTOS7}" == 1 ]] || fail "${requested_id} 的 BILL_ALLOW_EOL_CENTOS7 只能是 0 或 1"
}

resolve_targets() {
  SELECTED_TARGETS=()
  [[ "$#" -gt 0 ]] || fail "至少指定一个目标，或使用 --all"
  if [[ "$1" == "--all" ]]; then
    [[ "$#" -eq 1 ]] || fail "--all 不能与其他目标混用"
    [[ -f "${TARGET_LIST}" ]] || fail "找不到目标顺序文件：${TARGET_LIST}"
    local line
    while IFS= read -r line || [[ -n "${line}" ]]; do
      line="${line%$'\r'}"
      [[ -z "${line}" || "${line}" == \#* ]] && continue
      validate_target_id "${line}"
      SELECTED_TARGETS+=("${line}")
    done < "${TARGET_LIST}"
    [[ "${#SELECTED_TARGETS[@]}" -gt 0 ]] || fail "${TARGET_LIST} 没有可部署目标"
  else
    local target
    for target in "$@"; do
      validate_target_id "${target}"
      SELECTED_TARGETS+=("${target}")
    done
  fi
}

validate_local_connection_files() {
  [[ -f "${BILL_KNOWN_HOSTS_FILE}" ]] || fail "${BILL_TARGET_ID} 的 known_hosts 不存在：${BILL_KNOWN_HOSTS_FILE}"
  [[ -z "${BILL_IDENTITY_FILE}" || -f "${BILL_IDENTITY_FILE}" ]] || fail "${BILL_TARGET_ID} 的 SSH 私钥不存在：${BILL_IDENTITY_FILE}"
}

ssh_arguments() {
  SSH_ARGS=(-p "${BILL_SSH_PORT}" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o SendEnv=-LANG -o 'SendEnv=-LC_*' -o "UserKnownHostsFile=${BILL_KNOWN_HOSTS_FILE}")
  SCP_ARGS=(-P "${BILL_SSH_PORT}" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o SendEnv=-LANG -o 'SendEnv=-LC_*' -o "UserKnownHostsFile=${BILL_KNOWN_HOSTS_FILE}")
  if [[ -n "${BILL_IDENTITY_FILE}" ]]; then
    SSH_ARGS+=(-i "${BILL_IDENTITY_FILE}")
    SCP_ARGS+=(-i "${BILL_IDENTITY_FILE}")
  fi
}
