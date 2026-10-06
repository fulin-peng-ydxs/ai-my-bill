#!/usr/bin/env bash
set -euo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIRECTORY="${MY_BILL_DEPLOY_TARGET_DIRECTORY:-${PROJECT_ROOT}/.local/deploy-targets}"
TARGET_LIST="${TARGET_DIRECTORY}/targets.list"

fail() { echo "错误：$*" >&2; exit 1; }
source "${PROJECT_ROOT}/scripts/lib/deploy-target.sh"

usage() {
  cat <<'EOF'
用法：
  npm run ops -- status|health|backup-list|backup-key-status <目标...|--all>
  npm run ops -- logs <目标...|--all> [--service app|proxy|db|provision|migrate|bootstrap-admin|system] [--since 30m] [--tail 200] [--trace-id 标识] [--follow]
  npm run ops -- logs-export <目标> [--service 服务] [--since 2h] [--tail 10000] [--trace-id 标识]
  npm run ops -- start|stop|restart|backup <目标...|--all> [--yes]
  npm run ops -- backup-pull <目标> [YYYY-MM-DD]
  npm run ops -- backup-verify <目标> [YYYY-MM-DD]
  npm run ops -- backup-key-pull <目标> [--yes]
  npm run ops -- backup-key-restore <目标> [--yes]
  npm run ops -- recovery-drill <目标> <YYYY-MM-DD> [--yes]
  npm run ops -- offsite-recovery-drill <目标> <YYYY-MM-DD> [--yes]

backup-pull只复制已加密归档；backup-key-pull是一次性密钥托管动作，拒绝覆盖。
EOF
}

confirm() {
  local prompt="$1"
  [[ "${ASSUME_YES}" == true ]] && return 0
  [[ -r /dev/tty ]] || fail "非交互执行必须显式添加--yes"
  local answer; read -r -p "${prompt} [y/N] " answer </dev/tty
  [[ "${answer}" == y || "${answer}" == Y || "${answer}" == yes || "${answer}" == YES ]]
}

local_backup_directory() { printf '%s\n' "${BILL_OFFSITE_BACKUP_DIRECTORY:-${PROJECT_ROOT}/.local/offsite-backups/${BILL_TARGET_ID}}"; }
local_key_directory() { printf '%s\n' "${BILL_OFFSITE_KEY_DIRECTORY:-${PROJECT_ROOT}/.local/backup-keys/${BILL_TARGET_ID}}"; }
validate_local_storage_root() {
  local path="$1"
  [[ "${path}" == /* && "${path}" != / && "${path}" != "${HOME}" && "$(dirname "${path}")" != / ]] || fail "本机落点必须是非顶层、非用户主目录的绝对路径"
  [[ ! -L "${path}" ]] || fail "本机落点不能是符号链接：${path}"
  [[ ! -e "${path}" || -d "${path}" ]] || fail "本机落点不是目录：${path}"
}
ensure_private_directory() {
  local path="$1" mode
  if [[ ! -e "${path}" ]]; then
    mkdir -p "${path}"
    chmod 0700 "${path}"
    return
  fi
  mode="$(stat -f '%Lp' "${path}" 2>/dev/null || stat -c '%a' "${path}")"
  [[ "${mode}" =~ ^[0-7]+$ ]] || fail "无法读取目录权限：${path}"
  (( (8#${mode} & 077) == 0 )) || fail "本机敏感目录不得允许组或其他用户访问：${path}（当前${mode}）"
}
require_private_file() {
  local path="$1" mode
  [[ -f "${path}" && ! -L "${path}" ]] || fail "本机敏感文件不存在或不是普通文件：${path}"
  mode="$(stat -f '%Lp' "${path}" 2>/dev/null || stat -c '%a' "${path}")"
  [[ "${mode}" =~ ^[0-7]+$ ]] || fail "无法读取文件权限：${path}"
  (( (8#${mode} & 077) == 0 )) || fail "本机敏感文件不得允许组或其他用户访问：${path}（当前${mode}）"
}

remote_operation() {
  local action="$1" target="$2" backup_date="${3:-}" destination command remote_script="" temporary_script="" script_text=""
  load_target "${target}"; validate_local_connection_files; ssh_arguments
  destination="${BILL_SSH_USER}@${BILL_HOST}"
  case "${action}" in
    start|stop|restart|backup|recovery-drill)
      temporary_script="/tmp/my-bill-operate-${BILL_TARGET_ID}-$$.sh"
      scp "${SCP_ARGS[@]}" "${PROJECT_ROOT}/deploy/scripts/operate-service.sh" "${destination}:${temporary_script}"
      remote_script="${temporary_script}"
      ;;
  esac
  if [[ -n "${temporary_script}" ]]; then
    printf -v command 'LC_ALL=C LANG=C bash %q --action %q --release-root %q --env-file %q --ca-file %q --health-url %q --backup-service %q --backup-status-file %q --compose-overlay %q --health-timeout %q --backup-date %q' \
      "${remote_script}" "${action}" "${BILL_REMOTE_ROOT}" "${BILL_ENV_FILE}" "${BILL_CA_FILE}" "${BILL_HEALTH_URL}" \
      "${BILL_BACKUP_SERVICE}" "${BILL_BACKUP_STATUS_FILE}" "${BILL_COMPOSE_OVERLAY}" "${BILL_HEALTH_TIMEOUT_SECONDS}" "${backup_date}"
  else
    script_text="$(<"${PROJECT_ROOT}/deploy/scripts/operate-service.sh")"
    printf -v command 'LC_ALL=C LANG=C bash -c %q -- --action %q --release-root %q --env-file %q --ca-file %q --health-url %q --backup-service %q --backup-status-file %q --compose-overlay %q --health-timeout %q --backup-date %q' \
      "${script_text}" "${action}" "${BILL_REMOTE_ROOT}" "${BILL_ENV_FILE}" "${BILL_CA_FILE}" "${BILL_HEALTH_URL}" \
      "${BILL_BACKUP_SERVICE}" "${BILL_BACKUP_STATUS_FILE}" "${BILL_COMPOSE_OVERLAY}" "${BILL_HEALTH_TIMEOUT_SECONDS}" "${backup_date}"
  fi
  if [[ "${action}" == logs ]]; then
    command+=" $(printf '%s %q %s %q %s %q %s %q' --log-service "${LOG_SERVICE}" --log-since "${LOG_SINCE}" --log-tail "${LOG_TAIL}" --log-trace "${LOG_TRACE}")"
    [[ "${LOG_FOLLOW}" == false ]] || command+=" --log-follow"
  fi
  echo "[${BILL_TARGET_ID}] ${action}" >&2
  if [[ -n "${temporary_script}" ]]; then
    if ssh "${SSH_ARGS[@]}" "${destination}" "${command}"; then
      ssh "${SSH_ARGS[@]}" "${destination}" "rm -f $(printf '%q' "${temporary_script}")"
    else
      ssh "${SSH_ARGS[@]}" "${destination}" "rm -f $(printf '%q' "${temporary_script}")" || true
      return 1
    fi
  else
    ssh "${SSH_ARGS[@]}" "${destination}" "${command}"
  fi
}

resolve_backup_date() {
  local target="$1" requested="${2:-}" destination latest
  if [[ -n "${requested}" ]]; then [[ "${requested}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "备份日期必须为YYYY-MM-DD"; printf '%s\n' "${requested}"; return; fi
  load_target "${target}"; validate_local_connection_files; ssh_arguments; destination="${BILL_SSH_USER}@${BILL_HOST}"
  latest="$(ssh "${SSH_ARGS[@]}" "${destination}" "find /var/backups/my-bill/daily -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].cms' -printf '%f\\n' | LC_ALL=C sort | tail -n 1")"
  [[ "${latest}" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})\.cms$ ]] || fail "目标没有可用日备份"
  printf '%s\n' "${BASH_REMATCH[1]}"
}

pull_backup() {
  local target="$1" requested="${2:-}" date destination root staging
  date="$(resolve_backup_date "${target}" "${requested}")"
  load_target "${target}"; validate_local_connection_files; ssh_arguments; destination="${BILL_SSH_USER}@${BILL_HOST}"; root="$(local_backup_directory)"
  validate_local_storage_root "${root}"
  ensure_private_directory "${root}"; ensure_private_directory "${root}/daily"
  if [[ -f "${root}/daily/${date}.cms" && -f "${root}/daily/${date}.sha256" ]]; then verify_backup "${target}" "${date}"; echo "复用已校验异机副本：${root}/daily/${date}.cms"; return; fi
  [[ ! -e "${root}/daily/${date}.cms" && ! -e "${root}/daily/${date}.sha256" ]] || fail "本地副本不完整，拒绝覆盖：${root}/daily/${date}"
  staging="$(mktemp -d "${root}/.pull-${date}.XXXXXX")"
  trap 'rm -rf -- "${staging:-}"' RETURN
  scp "${SCP_ARGS[@]}" "${destination}:/var/backups/my-bill/daily/${date}.cms" "${destination}:/var/backups/my-bill/daily/${date}.sha256" "${staging}/"
  (cd "${staging}" && LC_ALL=C shasum -a 256 -c "${date}.sha256" >/dev/null)
  mv "${staging}/${date}.cms" "${staging}/${date}.sha256" "${root}/daily/"
  rmdir "${staging}"; trap - RETURN
  echo "异机加密副本已校验：${root}/daily/${date}.cms"
}

verify_backup() {
  local target="$1" requested="${2:-}" date root
  load_target "${target}"; date="$(resolve_backup_date "${target}" "${requested}")"; root="$(local_backup_directory)"
  validate_local_storage_root "${root}"
  [[ -f "${root}/daily/${date}.cms" && -f "${root}/daily/${date}.sha256" ]] || fail "本地异机副本不存在：${root}/daily/${date}"
  (cd "${root}/daily" && LC_ALL=C shasum -a 256 -c "${date}.sha256")
}

pull_backup_key() {
  local target="$1" destination root parent staging cert_hash key_hash
  load_target "${target}"; validate_local_connection_files; ssh_arguments; destination="${BILL_SSH_USER}@${BILL_HOST}"; root="$(local_key_directory)"; parent="$(dirname "${root}")"
  validate_local_storage_root "${root}"
  [[ ! -e "${root}" ]] || fail "密钥托管目录已存在，拒绝覆盖：${root}"
  mkdir -p "${parent}"; staging="$(mktemp -d "${parent}/.${BILL_TARGET_ID}.key.XXXXXX")"
  trap 'rm -rf -- "${staging:-}"' RETURN
  scp "${SCP_ARGS[@]}" "${destination}:/etc/my-bill/backup-encryption.key" "${destination}:/etc/my-bill/backup-encryption.crt" "${staging}/"
  chmod 0600 "${staging}/backup-encryption.key" "${staging}/backup-encryption.crt"
  cert_hash="$(openssl x509 -in "${staging}/backup-encryption.crt" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | shasum -a 256 | awk '{print $1}')"
  key_hash="$(openssl pkey -in "${staging}/backup-encryption.key" -pubout -outform DER 2>/dev/null | shasum -a 256 | awk '{print $1}')"
  [[ -n "${cert_hash}" && "${cert_hash}" == "${key_hash}" ]] || fail "备份证书与私钥不匹配"
  mv "${staging}" "${root}"; trap - RETURN
  echo "备份解密材料已受控复制并验证：${root}；请继续转存到组织密钥库，勿与唯一备份共址。"
}

local_key_material() {
  local target="$1" root backup_root latest archive_date cert_hash key_hash
  load_target "${target}"; root="$(local_key_directory)"; validate_local_storage_root "${root}"
  [[ -d "${root}" ]] || fail "本机托管的备份解密材料目录不存在：${root}"
  ensure_private_directory "${root}"
  require_private_file "${root}/backup-encryption.key"
  require_private_file "${root}/backup-encryption.crt"
  cert_hash="$(openssl x509 -in "${root}/backup-encryption.crt" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | shasum -a 256 | awk '{print $1}')"
  key_hash="$(openssl pkey -in "${root}/backup-encryption.key" -pubout -outform DER 2>/dev/null | shasum -a 256 | awk '{print $1}')"
  [[ -n "${cert_hash}" && "${cert_hash}" == "${key_hash}" ]] || fail "本机备份证书与私钥不匹配"
  backup_root="$(local_backup_directory)"
  validate_local_storage_root "${backup_root}"
  latest="$(find "${backup_root}/daily" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].cms' -print 2>/dev/null | LC_ALL=C sort | tail -n 1)"
  [[ -n "${latest}" ]] || fail "恢复密钥前需要至少一份已拉取的异机日备份"
  archive_date="$(basename "${latest}" .cms)"
  verify_backup "${target}" "${archive_date}" >/dev/null
  openssl cms -decrypt -binary -inform DER -in "${latest}" -recip "${root}/backup-encryption.crt" -inkey "${root}/backup-encryption.key" | tar -tzf - >/dev/null || fail "托管密钥无法完整解密最新异机副本"
  printf '%s\n' "${root}"
}

restore_backup_key() {
  local target="$1" root destination staging command
  root="$(local_key_material "${target}")"
  load_target "${target}"; validate_local_connection_files; ssh_arguments; destination="${BILL_SSH_USER}@${BILL_HOST}"
  staging="/tmp/my-bill-backup-key-${BILL_TARGET_ID}-$$"
  printf -v command 'set -euo pipefail; umask 077; test ! -e %q; install -d -m 0700 %q' "${staging}" "${staging}"
  ssh "${SSH_ARGS[@]}" "${destination}" "bash -c $(printf '%q' "${command}")"
  if ! scp "${SCP_ARGS[@]}" "${root}/backup-encryption.key" "${root}/backup-encryption.crt" "${destination}:${staging}/"; then
    ssh "${SSH_ARGS[@]}" "${destination}" "rm -rf -- $(printf '%q' "${staging}")" || true
    return 1
  fi
  printf -v command 'set -euo pipefail; key=%q/backup-encryption.key; cert=%q/backup-encryption.crt; test ! -e /etc/my-bill/backup-encryption.key; test ! -e /etc/my-bill/backup-encryption.crt; cert_hash=$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | awk '\''{print $1}'\''); key_hash=$(openssl pkey -in "$key" -pubout -outform DER 2>/dev/null | sha256sum | awk '\''{print $1}'\''); test -n "$cert_hash"; test "$cert_hash" = "$key_hash"; install -d -m 0700 /etc/my-bill; install -m 0600 "$key" /etc/my-bill/.backup-encryption.key.new; install -m 0600 "$cert" /etc/my-bill/.backup-encryption.crt.new; mv /etc/my-bill/.backup-encryption.key.new /etc/my-bill/backup-encryption.key; mv /etc/my-bill/.backup-encryption.crt.new /etc/my-bill/backup-encryption.crt' "${staging}" "${staging}"
  if ssh "${SSH_ARGS[@]}" "${destination}" "bash -c $(printf '%q' "${command}")"; then
    ssh "${SSH_ARGS[@]}" "${destination}" "rm -rf -- $(printf '%q' "${staging}")"
    echo "备份解密材料已恢复到${BILL_TARGET_ID}；目标原文件此前不存在。"
  else
    ssh "${SSH_ARGS[@]}" "${destination}" "rm -rf -- $(printf '%q' "${staging}")" || true
    return 1
  fi
}

offsite_recovery_drill() {
  local target="$1" date="$2" root destination staging command
  [[ "${date}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "备份日期必须为YYYY-MM-DD"
  verify_backup "${target}" "${date}" >/dev/null
  load_target "${target}"; validate_local_connection_files; ssh_arguments; destination="${BILL_SSH_USER}@${BILL_HOST}"; root="$(local_backup_directory)"
  staging="/var/backups/my-bill/recovery-staging/${date}-${BILL_TARGET_ID}-$$"
  printf -v command 'set -euo pipefail; test ! -e %q; install -d -m 0700 %q' "${staging}" "${staging}"
  ssh "${SSH_ARGS[@]}" "${destination}" "bash -c $(printf '%q' "${command}")"
  if ! scp "${SCP_ARGS[@]}" "${root}/daily/${date}.cms" "${root}/daily/${date}.sha256" "${PROJECT_ROOT}/deploy/scripts/verify-backup-restore.sh" "${destination}:${staging}/"; then
    ssh "${SSH_ARGS[@]}" "${destination}" "rm -rf -- $(printf '%q' "${staging}")" || true
    return 1
  fi
  printf -v command 'bash %q/verify-backup-restore.sh %q/%q.cms' "${staging}" "${staging}" "${date}"
  if ssh "${SSH_ARGS[@]}" "${destination}" "${command}"; then
    ssh "${SSH_ARGS[@]}" "${destination}" "rm -rf -- $(printf '%q' "${staging}")"
    echo "异机副本隔离恢复演练通过：${BILL_TARGET_ID}/${date}"
  else
    ssh "${SSH_ARGS[@]}" "${destination}" "rm -rf -- $(printf '%q' "${staging}")" || true
    return 1
  fi
}

LOG_SERVICE=all
LOG_SINCE=1h
LOG_TAIL=200
LOG_TRACE=""
LOG_FOLLOW=false

log_operation() {
  local action="$1"; shift
  local targets=() target root file
  [[ "${action}" != logs-export ]] || LOG_TAIL=10000
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --service|--since|--tail|--trace-id)
        [[ "$#" -ge 2 ]] || fail "$1缺少值"
        case "$1" in --service) LOG_SERVICE="$2" ;; --since) LOG_SINCE="$2" ;; --tail) LOG_TAIL="$2" ;; --trace-id) LOG_TRACE="$2" ;; esac
        shift 2 ;;
      --follow) LOG_FOLLOW=true; shift ;;
      --all) targets+=("$1"); shift ;;
      --*) fail "未知日志参数：$1" ;;
      *) targets+=("$1"); shift ;;
    esac
  done
  case "${LOG_SERVICE}" in all|app|proxy|db|provision|migrate|bootstrap-admin|system) ;; *) fail "日志服务不合法" ;; esac
  [[ "${LOG_TAIL}" =~ ^[1-9][0-9]*$ && ${#LOG_TAIL} -le 5 && "${LOG_TAIL}" -le 10000 ]] || fail "日志行数必须为1–10000"
  [[ "${LOG_SINCE}" =~ ^[1-9][0-9]{0,4}[smhd]$ ]] || fail "日志时间窗口不合法"
  [[ -z "${LOG_TRACE}" || "${LOG_TRACE}" =~ ^[a-zA-Z0-9_-]{1,128}$ ]] || fail "traceId不合法"
  resolve_targets "${targets[@]}"
  [[ "${LOG_FOLLOW}" == false || ( "${action}" == logs && "${#SELECTED_TARGETS[@]}" -eq 1 && "${LOG_SERVICE}" != all ) ]] || fail "跟随仅支持一个目标的指定服务"
  [[ "${action}" != logs-export || "${#SELECTED_TARGETS[@]}" -eq 1 ]] || fail "日志导出只支持一个目标"
  for target in "${SELECTED_TARGETS[@]}"; do
    if [[ "${action}" == logs-export ]]; then
      root="${PROJECT_ROOT}/.local/logs/operations/${target}"
      validate_local_storage_root "${root}"; ensure_private_directory "${root}"
      file="${root}/diagnostic.$(date -u '+%Y%m%dT%H%M%SZ').$$.log.gz"
      if remote_operation logs "${target}" | gzip > "${file}.partial"; then
        mv "${file}.partial" "${file}"
        echo "诊断日志：${file}（仅当前保留窗口及行数范围）"
      else
        rm -f "${file}.partial"; return 1
      fi
    else
      remote_operation logs "${target}"
    fi
  done
}

ASSUME_YES=false
main() {
  local action="${1:-}"; [[ -n "${action}" ]] || { usage; exit 1; }; shift || true
  if [[ "${*: -1}" == --yes ]]; then ASSUME_YES=true; set -- "${@:1:$(($#-1))}"; fi
  case "${action}" in
    status|health|backup-list|backup-key-status|start|stop|restart|backup)
      resolve_targets "$@"
      case "${action}" in start|stop|restart|backup) confirm "确认对${#SELECTED_TARGETS[@]}个目标执行${action}？" || fail "已取消" ;; esac
      local target
      for target in "${SELECTED_TARGETS[@]}"; do
        remote_operation "${action}" "${target}"
        if [[ "${action}" == backup ]]; then pull_backup "${target}"; fi
      done
      ;;
    logs|logs-export) log_operation "${action}" "$@" ;;
    backup-pull) [[ "$#" -ge 1 && "$#" -le 2 ]] || fail "backup-pull接受一个目标和可选日期"; pull_backup "$1" "${2:-}" ;;
    backup-verify) [[ "$#" -ge 1 && "$#" -le 2 ]] || fail "backup-verify接受一个目标和可选日期"; verify_backup "$1" "${2:-}" ;;
    backup-key-pull) [[ "$#" -eq 1 ]] || fail "backup-key-pull只接受一个目标"; confirm "确认从$1受控复制备份解密私钥？" || fail "已取消"; pull_backup_key "$1" ;;
    backup-key-restore) [[ "$#" -eq 1 ]] || fail "backup-key-restore只接受一个目标"; confirm "确认向$1恢复备份解密私钥（仅目标文件不存在时）？" || fail "已取消"; restore_backup_key "$1" ;;
    recovery-drill) [[ "$#" -eq 2 ]] || fail "recovery-drill需要目标和日期"; confirm "确认在$1执行隔离恢复演练（不连接生产库）？" || fail "已取消"; remote_operation recovery-drill "$1" "$2" ;;
    offsite-recovery-drill) [[ "$#" -eq 2 ]] || fail "offsite-recovery-drill需要目标和日期"; confirm "确认上传异机加密副本并在$1执行隔离恢复演练？" || fail "已取消"; offsite_recovery_drill "$1" "$2" ;;
    help|-h|--help) usage ;;
    *) usage; fail "未知操作：${action}" ;;
  esac
}
main "$@"
