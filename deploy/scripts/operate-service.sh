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

while [[ "$#" -gt 0 ]]; do
  case "$1" in
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

current="${release_root}/current"
[[ -d "${current}" ]] || fail "当前发布目录不存在：${current}"
[[ -f "${env_file}" ]] || fail "运行配置不存在：${env_file}"
compose() { (cd "${current}" && docker compose --env-file "${env_file}" -f deploy/compose.yaml -f "${compose_overlay}" "$@"); }
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

case "${action}" in
  status) print_status ;;
  health) print_status; curl --fail --silent --show-error --cacert "${ca_file}" "${health_url}"; echo ;;
  start) compose up -d db app; wait_app; compose up -d proxy; wait_health; print_status ;;
  stop) compose stop -t 60 proxy app; print_status ;;
  restart) compose stop -t 60 proxy app; compose up -d app; wait_app; compose up -d proxy; wait_health; print_status ;;
  logs)
    compose logs --no-color --tail=200 app proxy db
    journalctl -u "${backup_service}" -u my-bill-monitor.service -n 100 --no-pager
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
