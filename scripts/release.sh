#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIRECTORY="${MY_BILL_DEPLOY_TARGET_DIRECTORY:-${PROJECT_ROOT}/.local/deploy-targets}"
TARGET_LIST="${TARGET_DIRECTORY}/targets.list"
RELEASE_DIRECTORY="${PROJECT_ROOT}/.local/releases"

usage() {
  cat <<'EOF'
用法：
  npm run release -- build
  npm run release -- plan <目标...|--all>
  npm run release -- deploy <目标...|--all>
  npm run release -- status <目标...|--all>
  npm run release -- targets

目标配置默认位于 .local/deploy-targets/<目标>.env；--all 按 targets.list 顺序执行。
EOF
}

fail() {
  echo "错误：$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令：$1"
}

validate_target_id() {
  [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || fail "目标名称不合法：$1"
}

reset_target() {
  BILL_TARGET_ID=""
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
  BILL_COMPOSE_OVERLAY="deploy/compose.intranet.yaml"
  BILL_HEALTH_TIMEOUT_SECONDS="180"
}

assign_target_value() {
  local key="$1"
  local value="$2"
  case "${key}" in
    BILL_TARGET_ID) BILL_TARGET_ID="${value}" ;;
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
    BILL_COMPOSE_OVERLAY) BILL_COMPOSE_OVERLAY="${value}" ;;
    BILL_HEALTH_TIMEOUT_SECONDS) BILL_HEALTH_TIMEOUT_SECONDS="${value}" ;;
    *) fail "目标配置包含未知字段：${key}" ;;
  esac
}

validate_absolute_path() {
  [[ "$2" == /* && "$2" != *$'\n'* ]] || fail "$1 必须是绝对路径"
}

load_target() {
  local requested_id="$1"
  local config_file="${TARGET_DIRECTORY}/${requested_id}.env"
  local line key value

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
  [[ "${BILL_HOST}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || fail "${requested_id} 的 BILL_HOST 不合法（当前支持主机名或 IPv4）"
  [[ "${BILL_SSH_USER}" =~ ^[a-zA-Z_][a-zA-Z0-9._-]*$ ]] || fail "${requested_id} 的 BILL_SSH_USER 不合法"
  [[ "${BILL_SSH_PORT}" =~ ^[0-9]+$ && "${BILL_SSH_PORT}" -ge 1 && "${BILL_SSH_PORT}" -le 65535 ]] || fail "${requested_id} 的 BILL_SSH_PORT 不合法"
  validate_absolute_path BILL_REMOTE_ROOT "${BILL_REMOTE_ROOT}"
  validate_absolute_path BILL_ENV_FILE "${BILL_ENV_FILE}"
  validate_absolute_path BILL_CA_FILE "${BILL_CA_FILE}"
  validate_absolute_path BILL_BACKUP_STATUS_FILE "${BILL_BACKUP_STATUS_FILE}"
  validate_absolute_path BILL_KNOWN_HOSTS_FILE "${BILL_KNOWN_HOSTS_FILE}"
  [[ -z "${BILL_IDENTITY_FILE}" ]] || validate_absolute_path BILL_IDENTITY_FILE "${BILL_IDENTITY_FILE}"
  [[ "${BILL_HEALTH_URL}" == https://* && "${BILL_HEALTH_URL}" != *[$'\r\n\t ']* ]] || fail "${requested_id} 的 BILL_HEALTH_URL 必须是无空白的 https:// 地址"
  [[ "${BILL_COMPOSE_OVERLAY}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ && "${BILL_COMPOSE_OVERLAY}" != /* && "${BILL_COMPOSE_OVERLAY}" != *".."* ]] || fail "${requested_id} 的 BILL_COMPOSE_OVERLAY 不合法"
  [[ "${BILL_BACKUP_SERVICE}" =~ ^[a-zA-Z0-9@._-]+\.service$ ]] || fail "${requested_id} 的 BILL_BACKUP_SERVICE 不合法"
  [[ "${BILL_HEALTH_TIMEOUT_SECONDS}" =~ ^[0-9]+$ && "${BILL_HEALTH_TIMEOUT_SECONDS}" -ge 30 && "${BILL_HEALTH_TIMEOUT_SECONDS}" -le 900 ]] || fail "${requested_id} 的健康等待秒数必须在 30 到 900 之间"
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

sha256_check() {
  local directory="$1"
  (cd "${directory}" && shasum -a 256 -c SHA256SUMS >/dev/null)
}

build_release() {
  require_command git
  require_command npm
  require_command node
  require_command tar
  require_command shasum
  local commit status output staging manifest_file
  cd "${PROJECT_ROOT}"
  commit="$(git rev-parse HEAD)"
  status="$(git status --porcelain --untracked-files=all)"
  [[ -z "${status}" ]] || fail "持续构建只接受干净 HEAD；请先提交或处理当前改动"
  output="${RELEASE_DIRECTORY}/${commit}"
  if [[ -f "${output}/SHA256SUMS" ]] && sha256_check "${output}"; then
    echo "复用已校验制品：${output}"
    return
  fi
  [[ ! -e "${output}" ]] || fail "已有不完整或校验失败的制品目录：${output}"

  echo "[1/5] 完整工程检查"
  npm run check
  echo "[2/5] 性能检查"
  npm run check:performance
  echo "[3/5] 安全检查"
  npm run check:security
  echo "[4/5] 浏览器端到端检查"
  npm run check:e2e
  echo "[5/5] 构建候选并封装交付物"
  npm run build:release -- "${commit}"

  manifest_file="${PROJECT_ROOT}/.local/release-candidate/${commit}/manifest.txt"
  [[ -f "${manifest_file}" ]] || fail "候选 manifest 不存在：${manifest_file}"
  mkdir -p "${RELEASE_DIRECTORY}"
  staging="$(mktemp -d "${RELEASE_DIRECTORY}/.${commit}.staging.XXXXXX")"
  # macOS archive tools may invoke Perl for path/extended-attribute handling.
  # Force the portable POSIX locale on both archive commands so an inherited
  # Linux-only C.UTF-8 locale cannot break candidate packaging.
  LC_ALL=C LANG=C COPYFILE_DISABLE=1 git archive --format=tar "${commit}" .dockerignore .mvn mvnw pom.xml server deploy scripts > "${staging}/source.tar"
  LC_ALL=C LANG=C COPYFILE_DISABLE=1 tar --no-xattrs -czf "${staging}/web-dist.tar.gz" web/dist
  cp "${manifest_file}" "${staging}/manifest.txt"
  cp deploy/scripts/apply-release.sh "${staging}/apply-release.sh"
  chmod 0750 "${staging}/apply-release.sh"
  {
    echo "commit=${commit}"
    echo "builtAt=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "gates=check,check:performance,check:security,check:e2e,build:release"
  } > "${staging}/build.properties"
  (cd "${staging}" && shasum -a 256 source.tar web-dist.tar.gz manifest.txt apply-release.sh build.properties > SHA256SUMS)
  mv "${staging}" "${output}"
  echo "持续构建完成：${output}"
}

ssh_arguments() {
  SSH_ARGS=(-p "${BILL_SSH_PORT}" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=${BILL_KNOWN_HOSTS_FILE}")
  SCP_ARGS=(-P "${BILL_SSH_PORT}" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=${BILL_KNOWN_HOSTS_FILE}")
  if [[ -n "${BILL_IDENTITY_FILE}" ]]; then
    SSH_ARGS+=(-i "${BILL_IDENTITY_FILE}")
    SCP_ARGS+=(-i "${BILL_IDENTITY_FILE}")
  fi
}

validate_local_connection_files() {
  [[ -f "${BILL_KNOWN_HOSTS_FILE}" ]] || fail "${BILL_TARGET_ID} 的 known_hosts 不存在：${BILL_KNOWN_HOSTS_FILE}"
  [[ -z "${BILL_IDENTITY_FILE}" || -f "${BILL_IDENTITY_FILE}" ]] || fail "${BILL_TARGET_ID} 的 SSH 私钥不存在：${BILL_IDENTITY_FILE}"
}

print_plan() {
  local target="$1"
  load_target "${target}"
  cat <<EOF
目标：${BILL_TARGET_ID}
  SSH：${BILL_SSH_USER}@${BILL_HOST}:${BILL_SSH_PORT}
  发布根：${BILL_REMOTE_ROOT}
  运行配置：${BILL_ENV_FILE}
  Compose 覆盖：${BILL_COMPOSE_OVERLAY}
  健康检查：${BILL_HEALTH_URL}
  备份服务：${BILL_BACKUP_SERVICE}
  备份状态：${BILL_BACKUP_STATUS_FILE}
EOF
}

deploy_target() {
  local target="$1"
  local commit artifact remote_incoming destination remote_command timestamp log_file
  load_target "${target}"
  validate_local_connection_files
  ssh_arguments
  commit="$(git -C "${PROJECT_ROOT}" rev-parse HEAD)"
  artifact="${RELEASE_DIRECTORY}/${commit}"
  sha256_check "${artifact}" || fail "本地交付物校验失败：${artifact}"
  remote_incoming="${BILL_REMOTE_ROOT}/incoming/${commit}"
  destination="${BILL_SSH_USER}@${BILL_HOST}"
  timestamp="$(date '+%Y%m%d-%H%M%S')"
  mkdir -p "${artifact}/deployments"
  log_file="${artifact}/deployments/${BILL_TARGET_ID}-${timestamp}.log"

  printf -v remote_command 'install -d -m 0750 %q && install -d -m 0750 %q' "${BILL_REMOTE_ROOT}" "${remote_incoming}"
  echo "[${BILL_TARGET_ID}] 创建远端接收目录"
  ssh "${SSH_ARGS[@]}" "${destination}" "${remote_command}"
  echo "[${BILL_TARGET_ID}] 上传并校验候选 ${commit}"
  scp "${SCP_ARGS[@]}" \
    "${artifact}/source.tar" "${artifact}/web-dist.tar.gz" "${artifact}/manifest.txt" \
    "${artifact}/apply-release.sh" "${artifact}/build.properties" "${artifact}/SHA256SUMS" \
    "${destination}:${remote_incoming}/"
  printf -v remote_command 'bash %q --commit %q --incoming-dir %q --release-root %q --env-file %q --ca-file %q --health-url %q --backup-service %q --backup-status-file %q --compose-overlay %q --health-timeout %q' \
    "${remote_incoming}/apply-release.sh" "${commit}" "${remote_incoming}" "${BILL_REMOTE_ROOT}" \
    "${BILL_ENV_FILE}" "${BILL_CA_FILE}" "${BILL_HEALTH_URL}" "${BILL_BACKUP_SERVICE}" \
    "${BILL_BACKUP_STATUS_FILE}" "${BILL_COMPOSE_OVERLAY}" "${BILL_HEALTH_TIMEOUT_SECONDS}"
  if ssh "${SSH_ARGS[@]}" "${destination}" "${remote_command}" 2>&1 | tee "${log_file}"; then
    echo "[${BILL_TARGET_ID}] 更新成功，日志：${log_file}"
  else
    echo "[${BILL_TARGET_ID}] 更新失败；后续目标未执行，日志：${log_file}" >&2
    return 1
  fi
}

status_target() {
  local target="$1"
  local destination remote_command
  load_target "${target}"
  validate_local_connection_files
  ssh_arguments
  destination="${BILL_SSH_USER}@${BILL_HOST}"
  printf -v remote_command 'set -euo pipefail; cd %q/current; printf "revision="; cat REVISION; docker compose --env-file %q -f deploy/compose.yaml -f %q ps; curl --fail --silent --show-error --cacert %q %q' \
    "${BILL_REMOTE_ROOT}" "${BILL_ENV_FILE}" "${BILL_COMPOSE_OVERLAY}" "${BILL_CA_FILE}" "${BILL_HEALTH_URL}"
  echo "[${BILL_TARGET_ID}]"
  ssh "${SSH_ARGS[@]}" "${destination}" "bash -c $(printf '%q' "${remote_command}")"
  echo
}

list_targets() {
  if [[ ! -d "${TARGET_DIRECTORY}" ]]; then
    echo "尚未创建目标目录：${TARGET_DIRECTORY}"
    return
  fi
  local file id
  for file in "${TARGET_DIRECTORY}"/*.env; do
    [[ -e "${file}" ]] || continue
    id="$(basename "${file}" .env)"
    load_target "${id}"
    printf '%s\t%s@%s:%s\n' "${id}" "${BILL_SSH_USER}" "${BILL_HOST}" "${BILL_SSH_PORT}"
  done
}

main() {
  local action="${1:-}"
  [[ -n "${action}" ]] || { usage; exit 1; }
  shift || true
  case "${action}" in
    build)
      [[ "$#" -eq 0 ]] || fail "build 不接受目标参数"
      build_release
      ;;
    plan|deploy|status)
      resolve_targets "$@"
      if [[ "${action}" == "deploy" ]]; then
        # 长时间构建前先检查所有目标配置和本机连接材料，避免最后才发现拼写或路径错误。
        local candidate_target
        for candidate_target in "${SELECTED_TARGETS[@]}"; do
          load_target "${candidate_target}"
          validate_local_connection_files
        done
        build_release
      fi
      local target
      for target in "${SELECTED_TARGETS[@]}"; do
        case "${action}" in
          plan) print_plan "${target}" ;;
          deploy) deploy_target "${target}" ;;
          status) status_target "${target}" ;;
        esac
      done
      ;;
    targets)
      [[ "$#" -eq 0 ]] || fail "targets 不接受参数"
      list_targets
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage
      fail "未知操作：${action}"
      ;;
  esac
}

main "$@"
