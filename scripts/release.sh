#!/usr/bin/env bash
set -euo pipefail
umask 077

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

source "${PROJECT_ROOT}/scripts/lib/deploy-target.sh"

sha256_check() {
  local directory="$1"
  (cd "${directory}" && LC_ALL=C LANG=C shasum -a 256 -c SHA256SUMS >/dev/null)
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
  # macOS archive/checksum tools may invoke Perl for path or digest handling.
  # Force the portable POSIX locale so an inherited Linux-only C.UTF-8 locale
  # cannot break candidate packaging or subsequent artifact verification.
  LC_ALL=C LANG=C COPYFILE_DISABLE=1 git archive --format=tar "${commit}" .dockerignore .mvn mvnw pom.xml server deploy scripts > "${staging}/source.tar"
  LC_ALL=C LANG=C COPYFILE_DISABLE=1 tar --no-xattrs -czf "${staging}/web-dist.tar.gz" web/dist
  cp "${manifest_file}" "${staging}/manifest.txt"
  cp deploy/scripts/log-archive.sh "${staging}/log-archive.sh"
  cp deploy/scripts/apply-release.sh "${staging}/apply-release.sh"
  cp deploy/scripts/bootstrap-environment.sh "${staging}/bootstrap-environment.sh"
  cp deploy/scripts/preflight-host.sh "${staging}/preflight-host.sh"
  chmod 0750 "${staging}/apply-release.sh" "${staging}/bootstrap-environment.sh" "${staging}/preflight-host.sh"
  {
    echo "commit=${commit}"
    echo "builtAt=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "gates=check,check:performance,check:security,check:e2e,build:release"
    if [[ -n "${MY_BILL_SECURITY_EXCEPTION_FILE:-}" ]]; then
      echo "securityStatus=accepted-candidate-risk"
      echo "securityExceptionSha256=$(LC_ALL=C LANG=C shasum -a 256 "${MY_BILL_SECURITY_EXCEPTION_FILE}" | awk '{print $1}')"
    else
      echo "securityStatus=zero-osv-findings"
    fi
  } > "${staging}/build.properties"
  (cd "${staging}" && LC_ALL=C LANG=C shasum -a 256 source.tar web-dist.tar.gz manifest.txt apply-release.sh bootstrap-environment.sh preflight-host.sh log-archive.sh build.properties > SHA256SUMS)
  mv "${staging}" "${output}"
  echo "持续构建完成：${output}"
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

# 在耗时构建和任何远端写入前拦截已满磁盘；不清理共享主机的其他服务。
preflight_target() {
  load_target "$1"
  validate_local_connection_files
  ssh_arguments
  local command
  printf -v command 'LC_ALL=C LANG=C bash -s -- %q' "${BILL_REMOTE_ROOT}"
  ssh "${SSH_ARGS[@]}" -o ConnectTimeout=15 "${BILL_SSH_USER}@${BILL_HOST}" "${command}" <<'REMOTE'
set -euo pipefail
for directory in "$1" "$(docker info --format '{{.DockerRootDir}}')"; do
  available=$(df -Pk "$directory" | awk 'END {print $4}')
  [[ "$available" =~ ^[0-9]+$ && "$available" -ge 2097152 ]] || {
    echo "发布预检失败：$directory 可用空间不足 2GiB；先处理容量，未上传或停止服务。" >&2
    exit 1
  }
done
REMOTE
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
  if grep -Fqx 'securityStatus=accepted-candidate-risk' "${artifact}/build.properties"; then
    [[ "${BILL_TARGET_ID}" == intranet-main && "${BILL_HOST}" == 10.100.101.104 ]] || fail "此风险例外制品只能部署到获批内网目标"
    [[ -n "${MY_BILL_SECURITY_EXCEPTION_FILE:-}" ]] || fail "风险例外制品部署需提供原审批记录"
    local approval_sha
    approval_sha="$(LC_ALL=C LANG=C shasum -a 256 "${MY_BILL_SECURITY_EXCEPTION_FILE}" | awk '{print $1}')"
    grep -Fqx "securityExceptionSha256=${approval_sha}" "${artifact}/build.properties" || fail "审批记录与风险例外制品不一致"
    # Recheck candidate binding and expiry before remote writes, even when build artifacts are reused.
    npm run check:security
  fi
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
    "${artifact}/log-archive.sh" "${artifact}/apply-release.sh" "${artifact}/bootstrap-environment.sh" "${artifact}/preflight-host.sh" \
    "${artifact}/build.properties" "${artifact}/SHA256SUMS" \
    "${destination}:${remote_incoming}/"
  printf -v remote_command 'LC_ALL=C LANG=C bash %q --commit %q --incoming-dir %q --release-root %q --env-file %q --ca-file %q --health-url %q --backup-service %q --backup-status-file %q --compose-overlay %q --health-timeout %q' \
    "${remote_incoming}/apply-release.sh" "${commit}" "${remote_incoming}" "${BILL_REMOTE_ROOT}" \
    "${BILL_ENV_FILE}" "${BILL_CA_FILE}" "${BILL_HEALTH_URL}" "${BILL_BACKUP_SERVICE}" \
    "${BILL_BACKUP_STATUS_FILE}" "${BILL_COMPOSE_OVERLAY}" "${BILL_HEALTH_TIMEOUT_SECONDS}"
  remote_command+=" $(printf '%s %q %s %q %s %q' --log-archive-directory "${BILL_LOG_ARCHIVE_DIRECTORY}" --log-archive-days "${BILL_LOG_ARCHIVE_DAYS}" --log-archive-total-mb "${BILL_LOG_ARCHIVE_TOTAL_MB}")"
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
          preflight_target "${candidate_target}"
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
