#!/usr/bin/env bash
set -euo pipefail

fail() { echo "错误：$*" >&2; exit 1; }

action=""
release_root=""
env_file=""
ca_file=""
health_url=""
backup_service=""
backup_status_file=""
compose_overlay=""
backup_date=""
health_timeout=180
log_service=all
log_since=1h
log_tail=200
log_trace=""
log_follow=false
log_archive_id=""
log_archive_directory=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --log-archive-id) log_archive_id="${2:-}"; shift 2 ;;
    --log-archive-directory) log_archive_directory="${2:-}"; shift 2 ;;
    --log-service) log_service="${2:-}"; shift 2 ;;
    --log-since) log_since="${2:-}"; shift 2 ;;
    --log-tail) log_tail="${2:-}"; shift 2 ;;
    --log-trace) log_trace="${2:-}"; shift 2 ;;
    --log-follow) log_follow=true; shift ;;
    --action) action="${2:-}"; shift 2 ;;
    --release-root) release_root="${2:-}"; shift 2 ;;
    --env-file) env_file="${2:-}"; shift 2 ;;
    --ca-file) ca_file="${2:-}"; shift 2 ;;
    --health-url) health_url="${2:-}"; shift 2 ;;
    --backup-service) backup_service="${2:-}"; shift 2 ;;
    --backup-status-file) backup_status_file="${2:-}"; shift 2 ;;
    --compose-overlay) compose_overlay="${2:-}"; shift 2 ;;
    --backup-date) backup_date="${2:-}"; shift 2 ;;
    --health-timeout) health_timeout="${2:-}"; shift 2 ;;
    *) fail "未知参数：$1" ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || fail "服务运维必须由root执行"
case "${action}" in status|health|start|stop|restart|logs|backup|backup-list|backup-key-status|recovery-drill) ;; *) fail "action不合法" ;; esac
for path in "${release_root}" "${env_file}" "${ca_file}" "${backup_status_file}"; do [[ "${path}" == /* ]] || fail "路径必须为绝对路径：${path}"; done
[[ "${health_url}" == https://* && "${health_url}" != *[$'\r\n\t ']* ]] || fail "健康地址不合法"
[[ "${backup_service}" =~ ^[a-zA-Z0-9@._-]+\.service$ ]] || fail "备份服务名不合法"
[[ "${compose_overlay}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ && "${compose_overlay}" != /* && "${compose_overlay}" != *".."* ]] || fail "Compose覆盖路径不合法"
[[ "${health_timeout}" =~ ^[0-9]+$ && "${health_timeout}" -ge 30 && "${health_timeout}" -le 900 ]] || fail "健康等待秒数不合法"
[[ -z "${backup_date}" || "${backup_date}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "备份日期必须为YYYY-MM-DD"

case "${log_service}" in all|app|proxy|db|provision|migrate|bootstrap-admin|system) ;; *) fail "日志服务不合法" ;; esac
[[ "${log_tail}" =~ ^[1-9][0-9]*$ && ${#log_tail} -le 5 && "${log_tail}" -le 10000 ]] || fail "日志行数必须为1–10000"
[[ -z "${log_trace}" || "${log_trace}" =~ ^[a-zA-Z0-9_-]{1,128}$ ]] || fail "traceId不合法"
[[ "${log_since}" =~ ^([1-9][0-9]{0,4})([smhd])$ ]] || fail "日志时间窗口使用1–99999加s/m/h/d"
log_amount="${BASH_REMATCH[1]}"; log_unit="${BASH_REMATCH[2]}"
case "${log_unit}" in s) log_seconds=${log_amount} ;; m) log_seconds=$((log_amount * 60)) ;; h) log_seconds=$((log_amount * 3600)) ;; d) log_seconds=$((log_amount * 86400)) ;; esac
[[ "${log_seconds}" -le 2592000 ]] || fail "日志时间窗口最多30天"
[[ "${log_follow}" == false || "${log_service}" != all ]] || fail "跟随日志必须指定一个服务"

current="${release_root}/current"
[[ -d "${current}" ]] || fail "当前发布目录不存在：${current}"
[[ -f "${env_file}" ]] || fail "运行配置不存在：${env_file}"
compose() { (cd "${current}" && export MY_BILL_VERSION="$(cat REVISION 2>/dev/null || echo unknown)" && docker compose --env-file "${env_file}" -f deploy/compose.yaml -f "${compose_overlay}" "$@"); }
wait_health() {
  local deadline=$((SECONDS + health_timeout))
  until curl --fail --silent --show-error --cacert "${ca_file}" "${health_url}" >/dev/null; do
    (( SECONDS < deadline )) || fail "服务在${health_timeout}秒内未通过HTTPS健康检查"
    sleep 3
  done
}
wait_app() {
  local deadline=$((SECONDS + health_timeout)) container state
  while true; do
    container="$(compose ps -q app)"
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null || true)"
    [[ "${state}" == healthy ]] && return
    (( SECONDS < deadline )) || fail "应用在${health_timeout}秒内未健康，当前状态：${state:-unknown}"
    sleep 3
  done
}
print_status() {
  printf 'revision='; cat "${current}/REVISION" 2>/dev/null || echo unknown
  compose ps
  systemctl show "${backup_service}" -p ActiveState -p SubState -p Result --no-pager
  systemctl show my-bill-backup.timer my-bill-monitor.timer -p Id -p ActiveState -p NextElapseUSecRealtime --no-pager 2>/dev/null || true
  if [[ -f "${backup_status_file}" ]]; then sed -n '1,10p' "${backup_status_file}"; else echo 'backupStatus=missing'; fi
}

log_output() {
  if [[ -n "${log_archive_id}" ]]; then
    local archive_root="${log_archive_directory:-${release_root}/logs}" selected_file
    source "${current}/deploy/scripts/log-archive.sh"
    log_archive_validate_path "${archive_root}" || return 1
    [[ -f "${archive_root}/.my-bill-log-archive" && ! -L "${archive_root}/.my-bill-log-archive" ]] || fail "归档目录不存在或未经登记"
    grep -Fqx my-bill-log-archive-v1 "${archive_root}/.my-bill-log-archive" || fail "归档目录标记不合法"
    [[ "${log_service}" == all && "${log_follow}" == false ]] || fail "归档查询不接受service或follow"
    if [[ "${log_archive_id}" == latest ]]; then
      log_archive_id="$(log_archive_latest "${archive_root}")"
    fi
    log_archive_name_valid "${log_archive_id}" || fail "归档不存在或文件名不合法"
    [[ -f "${archive_root}/${log_archive_id}" && ! -L "${archive_root}/${log_archive_id}" ]] || fail "归档文件不存在"
    echo "source=archive file=${log_archive_id} (whole record; since does not filter archived events)" >&2
    gzip -cd "${archive_root}/${log_archive_id}" | tail -n "${log_tail}"
    return
  fi
  local since_epoch=$(($(date +%s) - log_seconds))
  local flags=(--no-color --timestamps --since "${since_epoch}" --tail "${log_tail}")
  [[ "${log_follow}" == false ]] || flags+=(--follow)
  if [[ "${log_service}" == all ]]; then
    echo "source=current-container window=${log_since} tail=${log_tail} (capacity-retained, not complete history)"
    compose logs "${flags[@]}" app proxy db
    echo "source=system-journal"
    journalctl -u "${backup_service}" -u my-bill-monitor.service --since "@${since_epoch}" -n "${log_tail}" --no-pager
  elif [[ "${log_service}" == system ]]; then
    local journal_flags=()
    [[ "${log_follow}" == false ]] || journal_flags+=(--follow)
    journalctl -u "${backup_service}" -u my-bill-monitor.service --since "@${since_epoch}" -n "${log_tail}" --no-pager "${journal_flags[@]}"
  else
    # One-shot bootstrap uses its overlay only when explicitly selected.
    if [[ "${log_service}" == bootstrap-admin ]]; then
      (cd "${current}" && export MY_BILL_VERSION="$(cat REVISION 2>/dev/null || echo unknown)" && docker compose --env-file "${env_file}" -f deploy/compose.yaml -f "${compose_overlay}" -f deploy/compose.bootstrap.yaml logs "${flags[@]}" bootstrap-admin)
    else
      compose logs "${flags[@]}" "${log_service}"
    fi
  fi
}

case "${action}" in
  status) print_status ;;
  health) print_status; curl --fail --silent --show-error --cacert "${ca_file}" "${health_url}"; echo ;;
  start) compose up -d db app; wait_app; compose up -d proxy; wait_health; print_status ;;
  stop) compose stop -t 60 proxy app; print_status ;;
  restart) compose stop -t 60 proxy app; compose up -d app; wait_app; compose up -d proxy; wait_health; print_status ;;
  logs)
    if [[ -z "${log_trace}" ]]; then
      log_output
    else
      # awk has no grep no-match failure; flush each match for follow mode.
      log_output | awk -v trace="${log_trace}" 'index($0, trace) { print; fflush(); found=1 } END { if (!found) print "未找到traceId；可能超过日志保留窗口。" > "/dev/stderr" }'
    fi
    ;;
  backup)
    backup_started="$(date -u +%s)"
    systemctl start "${backup_service}"
    [[ "$(systemctl show "${backup_service}" -p Result --value)" == success ]] || fail "备份服务执行失败"
    [[ -f "${backup_status_file}" ]] || fail "备份状态文件不存在"
    grep -Fqx 'status=SUCCEEDED' "${backup_status_file}" || fail "备份状态不是SUCCEEDED"
    completed="$(awk -F= '$1 == "latestCompletedAt" {print $2}' "${backup_status_file}")"
    completed_epoch="$(date -u -d "${completed}" +%s 2>/dev/null || echo 0)"
    (( completed_epoch >= backup_started )) || fail "备份成功时间早于本次触发，拒绝复用旧状态"
    cat "${backup_status_file}"
    ;;
  backup-list)
    find /var/backups/my-bill/daily -maxdepth 1 -type f -name '*.cms' -printf '%f\n' | LC_ALL=C sort
    ;;
  backup-key-status)
    key=/etc/my-bill/backup-encryption.key; cert=/etc/my-bill/backup-encryption.crt
    [[ -r "${key}" && -r "${cert}" ]] || fail "备份解密密钥或证书不可读"
    [[ "$(stat -c '%a' "${key}")" == 600 ]] || fail "备份解密私钥权限不是0600"
    printf 'certificateSha256='; openssl x509 -in "${cert}" -noout -fingerprint -sha256 | cut -d= -f2
    ;;
  recovery-drill)
    [[ -n "${backup_date}" ]] || fail "recovery-drill必须指定备份日期"
    archive="/var/backups/my-bill/daily/${backup_date}.cms"
    [[ -f "${archive}" ]] || fail "备份不存在：${archive}"
    bash "${current}/deploy/scripts/verify-backup-restore.sh" "${archive}"
    ;;
esac
