#!/usr/bin/env bash
# Shared archive boundary. No Python/Node dependency on deployment hosts.

log_archive_fail() { echo "日志归档错误：$*" >&2; return 1; }
log_archive_validate_path() {
  local path="$1" parent
  [[ "${path}" == /* && "${path}" != / && "$(dirname "${path}")" != / && "${path}" != *$'\n'* ]] || { log_archive_fail '需要非顶层绝对目录'; return 1; }
  parent="${path}"
  while [[ "${parent}" != / ]]; do
    [[ ! -L "${parent}" ]] || { log_archive_fail '目录及父级不能是符号链接'; return 1; }
    parent="$(dirname "${parent}")"
  done
}
log_archive_stat() { stat -c '%s %Y %a' "$1" 2>/dev/null || stat -f '%z %m %Lp' "$1"; }
log_archive_prepare() {
  LOG_ARCHIVE_ROOT="$1"; LOG_ARCHIVE_DAYS="$2"; LOG_ARCHIVE_MB="$3"
  log_archive_validate_path "${LOG_ARCHIVE_ROOT}" || return 1
  [[ "${LOG_ARCHIVE_DAYS}" =~ ^[1-9][0-9]{0,2}$ && "${LOG_ARCHIVE_DAYS}" -le 365 ]] || { log_archive_fail '保留期需1–365天'; return 1; }
  [[ "${LOG_ARCHIVE_MB}" =~ ^[1-9][0-9]{0,4}$ && "${LOG_ARCHIVE_MB}" -ge 100 && "${LOG_ARCHIVE_MB}" -le 10240 ]] || { log_archive_fail '总容量需100–10240MB'; return 1; }
  umask 077
  mkdir -p "${LOG_ARCHIVE_ROOT}"
  local size modified mode
  read -r size modified mode < <(log_archive_stat "${LOG_ARCHIVE_ROOT}")
  (( (8#${mode} & 077) == 0 )) || { log_archive_fail '归档目录需0700且不能对组/其他用户开放'; return 1; }
  if [[ -e "${LOG_ARCHIVE_ROOT}/.my-bill-log-archive" ]]; then
    [[ -f "${LOG_ARCHIVE_ROOT}/.my-bill-log-archive" && ! -L "${LOG_ARCHIVE_ROOT}/.my-bill-log-archive" ]] || return 1
    grep -Fqx 'my-bill-log-archive-v1' "${LOG_ARCHIVE_ROOT}/.my-bill-log-archive" || return 1
  else
    [[ -z "$(ls -A "${LOG_ARCHIVE_ROOT}")" ]] || { log_archive_fail '拒绝接管已有非归档目录'; return 1; }
    printf '%s\n' my-bill-log-archive-v1 > "${LOG_ARCHIVE_ROOT}/.my-bill-log-archive"
  fi
}
log_archive_name_valid() {
  [[ "$1" =~ ^(snapshot|deployment|bootstrap|diagnostic)\.[0-9]{8}T[0-9]{6}Z\.[0-9]+\.[a-zA-Z0-9_-]{1,64}\.[a-zA-Z0-9]{6}\.log\.gz$ ]]
}
log_archive_latest() {
  local root="$1" file name size modified mode best_time=0 best=""
  while IFS= read -r file; do
    name="${file##*/}"; log_archive_name_valid "${name}" || continue
    [[ ! -L "${file}" ]] || continue
    read -r size modified mode < <(log_archive_stat "${file}")
    if (( modified >= best_time )); then best_time="${modified}"; best="${name}"; fi
  done < <(find "${root}" -maxdepth 1 -type f -name '*.log.gz' -print | LC_ALL=C sort)
  printf '%s\n' "${best}"
}
log_archive_prune() {
  local file name size modified mode now total=0
  local files=()
  now="$(date +%s)"
  # Recover only our abandoned temporary records. Live writers are identified by their originating PID.
  while IFS= read -r file; do
    name="${file##*/}"
    if [[ "${name}" =~ ^\.(snapshot|deployment|bootstrap|diagnostic)\.[0-9]{8}T[0-9]{6}Z\.([0-9]+)\.[a-zA-Z0-9_-]{1,64}\.[a-zA-Z0-9]{6}(\.gz)?$ ]]; then
      kill -0 "${BASH_REMATCH[2]}" 2>/dev/null || rm -- "${file}"
    fi
  done < <(find "${LOG_ARCHIVE_ROOT}" -maxdepth 1 -type f -name '.*' -print)
  # Only finalized, namespaced ordinary files; never descend into other directories or touch partial records.
  while IFS= read -r file; do
    name="${file##*/}"
    log_archive_name_valid "${name}" || continue
    [[ -f "${file}" && ! -L "${file}" ]] || continue
    read -r size modified mode < <(log_archive_stat "${file}")
    if (( modified < now - LOG_ARCHIVE_DAYS * 86400 )); then rm -- "${file}"; continue; fi
    files+=("${modified} ${file}"); total=$((total + size))
  done < <(find "${LOG_ARCHIVE_ROOT}" -maxdepth 1 -type f -name '*.log.gz' -print | LC_ALL=C sort)
  while IFS= read -r file; do
    [[ -n "${file}" ]] || continue
    file="${file#* }"
    (( total > LOG_ARCHIVE_MB * 1024 * 1024 )) || break
    read -r size modified mode < <(log_archive_stat "${file}")
    rm -- "${file}"; total=$((total - size))
  done < <(printf '%s\n' "${files[@]-}" | LC_ALL=C sort -n)
}
log_archive_write() (
  set -euo pipefail
  local kind="$1" revision="$2"; shift 2
  [[ "${kind}" == snapshot || "${kind}" == deployment || "${kind}" == bootstrap ]] || exit 1
  [[ "${revision}" =~ ^[a-zA-Z0-9_-]{1,64}$ ]] || exit 1
  local raw name code=0 statuses
  raw="$(mktemp "${LOG_ARCHIVE_ROOT}/.${kind}.$(date -u '+%Y%m%dT%H%M%SZ').$$.${revision}.XXXXXX")"
  name="${raw##*/}"; name="${name#.}.log"
  local cleanup_command
  printf -v cleanup_command 'rm -f -- %q %q' "${raw}" "${raw}.gz"
  trap "${cleanup_command}" EXIT
  log_archive_prune
  # Bound each active raw record at 100MB; file limit applies to tee only, not build/application children.
  set +e
  {
    printf 'archiveKind=%s revision=%s startedAt=%s\n' "${kind}" "${revision}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    "$@"
  } 2>&1 | (set -o noclobber; ulimit -f 102400; tee "${raw}")
  statuses=("${PIPESTATUS[@]}")
  code="${statuses[0]}"
  [[ "${statuses[1]}" == 0 ]] || code=74
  set -e
  printf '\narchiveResult=%s completedAt=%s\n' "${code}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "${raw}"
  gzip -c "${raw}" > "${raw}.gz"
  gzip -t "${raw}.gz"
  mv "${raw}.gz" "${LOG_ARCHIVE_ROOT}/${name}.gz"
  log_archive_prune
  echo "归档：${LOG_ARCHIVE_ROOT}/${name}.gz" >&2
  exit "${code}"
)
