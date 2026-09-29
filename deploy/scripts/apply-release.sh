#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "错误：$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "目标主机缺少命令：$1"
}

commit=""
incoming_dir=""
release_root=""
env_file=""
ca_file=""
health_url=""
backup_service=""
backup_status_file=""
compose_overlay=""
health_timeout="180"

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --commit) commit="${2:-}"; shift 2 ;;
    --incoming-dir) incoming_dir="${2:-}"; shift 2 ;;
    --release-root) release_root="${2:-}"; shift 2 ;;
    --env-file) env_file="${2:-}"; shift 2 ;;
    --ca-file) ca_file="${2:-}"; shift 2 ;;
    --health-url) health_url="${2:-}"; shift 2 ;;
    --backup-service) backup_service="${2:-}"; shift 2 ;;
    --backup-status-file) backup_status_file="${2:-}"; shift 2 ;;
    --compose-overlay) compose_overlay="${2:-}"; shift 2 ;;
    --health-timeout) health_timeout="${2:-}"; shift 2 ;;
    *) fail "未知参数：$1" ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || fail "发布切换必须由 root 执行"
[[ "${commit}" =~ ^[0-9a-f]{40}$ ]] || fail "commit 必须是完整 Git SHA"
for path in "${incoming_dir}" "${release_root}" "${env_file}" "${ca_file}" "${backup_status_file}"; do
  [[ "${path}" == /* ]] || fail "路径必须为绝对路径：${path}"
done
[[ "${incoming_dir}" == "${release_root}/incoming/${commit}" ]] || fail "接收目录不属于本次候选"
[[ "${health_url}" == https://* && "${health_url}" != *[$'\r\n\t ']* ]] || fail "健康检查必须是无空白的 HTTPS 地址"
[[ "${backup_service}" =~ ^[a-zA-Z0-9@._-]+\.service$ ]] || fail "备份服务名不合法"
[[ "${compose_overlay}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ && "${compose_overlay}" != /* && "${compose_overlay}" != *".."* ]] || fail "Compose 覆盖文件路径不合法"
[[ "${health_timeout}" =~ ^[0-9]+$ && "${health_timeout}" -ge 30 && "${health_timeout}" -le 900 ]] || fail "健康等待秒数不合法"

require_command curl
require_command date
require_command docker
require_command sha256sum
require_command systemctl
require_command tar
[[ -f "${env_file}" ]] || fail "运行配置不存在：${env_file}"
[[ -f "${ca_file}" ]] || fail "CA 公钥不存在：${ca_file}"
for file in source.tar web-dist.tar.gz manifest.txt apply-release.sh build.properties SHA256SUMS; do
  [[ -f "${incoming_dir}/${file}" ]] || fail "交付文件缺失：${file}"
done

validate_archive() {
  local archive="$1"
  local mode="$2"
  local entry list_file
  list_file="${incoming_dir}/.$(basename "${archive}").entries"
  tar "${mode}" "${archive}" > "${list_file}"
  while IFS= read -r entry; do
    case "${entry}" in
      /*|../*|*/../*|*/..|..) fail "归档包含越界路径：${entry}" ;;
    esac
  done < "${list_file}"
}

compose_at() {
  local directory="$1"
  shift
  (
    cd "${directory}"
    docker compose --env-file "${env_file}" -f deploy/compose.yaml -f "${compose_overlay}" "$@"
  )
}

echo "[1/8] 校验交付物"
(cd "${incoming_dir}" && sha256sum -c SHA256SUMS)
grep -Fqx "commit=${commit}" "${incoming_dir}/build.properties" || fail "构建记录与候选提交不一致"
validate_archive "${incoming_dir}/source.tar" -tf
validate_archive "${incoming_dir}/web-dist.tar.gz" -tzf

release_directory="${release_root}/releases/${commit}"
install -d -m 0750 "${release_root}/releases"
if [[ ! -d "${release_directory}" ]]; then
  staging_directory="$(mktemp -d "${release_root}/releases/.${commit}.staging.XXXXXX")"
  tar --no-same-owner -xf "${incoming_dir}/source.tar" -C "${staging_directory}"
  tar --no-same-owner -xzf "${incoming_dir}/web-dist.tar.gz" -C "${staging_directory}"
  printf '%s\n' "${commit}" > "${staging_directory}/REVISION"
  chown -R root:root "${staging_directory}"
  mv "${staging_directory}" "${release_directory}"
else
  [[ "$(cat "${release_directory}/REVISION" 2>/dev/null || true)" == "${commit}" ]] || fail "候选目录已存在但版本标记不匹配"
fi

current_path="${release_root}/current"
[[ -e "${current_path}" ]] || fail "当前版本不存在；首次部署不属于持续更新范围"
old_worktree="$(cd "${current_path}" && pwd -P)"
old_revision="$(cat "${old_worktree}/REVISION" 2>/dev/null || echo unknown)"
if [[ ! "${old_revision}" =~ ^[0-9a-f]{40}$ ]]; then
  old_revision="unknown"
fi
old_revision_label="$(printf '%s' "${old_revision}" | tr -c 'a-zA-Z0-9._-' '_')"
if [[ "${old_revision}" == "${commit}" ]] && curl --fail --silent --show-error --cacert "${ca_file}" "${health_url}" >/dev/null; then
  echo "目标已经运行健康候选 ${commit}，无需重复更新。"
  exit 0
fi

[[ -f "${release_directory}/deploy/compose.yaml" ]] || fail "候选缺少基础 Compose 文件"
[[ -f "${release_directory}/${compose_overlay}" ]] || fail "候选缺少 Compose 覆盖文件"

services_stopped=false
migration_attempted=false
on_exit() {
  local code=$?
  if [[ "${code}" -ne 0 ]]; then
    echo "发布失败：servicesStopped=${services_stopped}, migrationAttempted=${migration_attempted}" >&2
    if [[ "${services_stopped}" == true && "${migration_attempted}" == false ]]; then
      echo "迁移尚未开始，尝试恢复旧 app/proxy。" >&2
      # stop 不删除容器；start 保证恢复原容器/原镜像，避免默认标签已被新构建覆盖。
      compose_at "${old_worktree}" start app proxy || true
    else
      echo "迁移已尝试或状态未知，不自动回切数据库/应用；保持入口状态并人工判断。" >&2
    fi
  fi
}
trap on_exit EXIT

echo "[2/8] 校验候选配置"
compose_at "${release_directory}" config --quiet

timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
short_commit="${commit:0:12}"
preserve_running_image() {
  local container="$1"
  local target_repository="$2"
  local image_id
  image_id="$(docker inspect "${container}" --format '{{.Image}}' 2>/dev/null || true)"
  if [[ -n "${image_id}" ]]; then
    docker tag "${image_id}" "${target_repository}:before-${short_commit}-${timestamp}"
    echo "保留旧镜像 ${target_repository}:before-${short_commit}-${timestamp}=${image_id}"
  fi
}
preserve_running_image my-bill-app-1 my-bill-app
preserve_running_image my-bill-proxy-1 my-bill-proxy

echo "[3/8] 构建新 app/migrate/proxy 镜像"
compose_at "${release_directory}" build app migrate proxy
new_app_image="$(docker image inspect my-bill-app --format '{{.Id}}')"
new_migrate_image="$(docker image inspect my-bill-migrate --format '{{.Id}}')"
new_proxy_image="$(docker image inspect my-bill-proxy --format '{{.Id}}')"

echo "[4/8] 执行维护前备份"
backup_started_epoch="$(date -u +%s)"
systemctl start "${backup_service}"
[[ "$(systemctl show "${backup_service}" -p Result --value)" == "success" ]] || fail "维护前备份失败"
[[ -f "${backup_status_file}" ]] || fail "备份没有生成状态文件：${backup_status_file}"
backup_status="$(awk -F= '$1 == "status" {print $2}' "${backup_status_file}")"
backup_completed_at="$(awk -F= '$1 == "latestCompletedAt" {print $2}' "${backup_status_file}")"
backup_completed_epoch="$(date -u -d "${backup_completed_at}" +%s 2>/dev/null || echo 0)"
[[ "${backup_status}" == "SUCCEEDED" && "${backup_completed_epoch}" -ge "${backup_started_epoch}" ]] || fail "维护前备份状态或完成时间无效"

echo "[5/8] 停止外部入口与应用"
services_stopped=true
compose_at "${old_worktree}" stop -t 60 proxy app

echo "[6/8] 执行数据库迁移"
migration_attempted=true
compose_at "${release_directory}" run --rm --no-deps -T migrate < /dev/null

echo "[7/8] 原子切换候选并启动"
if [[ -L "${current_path}" ]]; then
  next_link="${release_root}/.current.${commit}.next"
  [[ ! -e "${next_link}" && ! -L "${next_link}" ]] || fail "临时 current 链接已存在：${next_link}"
  ln -s "${release_directory}" "${next_link}"
  mv -Tf "${next_link}" "${current_path}"
else
  archived_current="${release_root}/releases/before-${timestamp}-${old_revision_label:0:12}"
  [[ ! -e "${archived_current}" ]] || fail "旧版本保留目录已存在：${archived_current}"
  mv "${current_path}" "${archived_current}"
  ln -s "${release_directory}" "${current_path}"
fi

compose_at "${release_directory}" up -d --force-recreate app
deadline=$((SECONDS + health_timeout))
while true; do
  app_container="$(compose_at "${release_directory}" ps -q app)"
  app_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${app_container}" 2>/dev/null || true)"
  [[ "${app_health}" == "healthy" ]] && break
  [[ "${SECONDS}" -lt "${deadline}" ]] || fail "app 在 ${health_timeout} 秒内未健康，当前状态：${app_health:-unknown}"
  sleep 3
done
compose_at "${release_directory}" up -d --force-recreate proxy

echo "[8/8] 验证 HTTPS 并记录版本"
curl --fail --silent --show-error --cacert "${ca_file}" "${health_url}" >/dev/null
cp "${incoming_dir}/manifest.txt" "${release_directory}/release-manifest.txt"
cp "${incoming_dir}/build.properties" "${release_directory}/build.properties"
app_jar_sha256="$(docker run --rm --entrypoint sha256sum my-bill-app /app/my-bill-server.jar | awk '{print $1}')"
database_image="$(docker inspect my-bill-db-1 --format '{{.Image}}')"
schema_version="$(docker exec my-bill-db-1 psql -U my_bill_admin -d my_bill -Atc "select coalesce((select installed_rank::text || ':' || version from flyway_schema_history where success order by installed_rank desc limit 1), 'none')")"
env_sha256="$(sha256sum "${env_file}" | awk '{print $1}')"
cat > "${release_directory}/deployment.properties" <<EOF
commit=${commit}
deployedAt=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
previousRevision=${old_revision}
appImage=${new_app_image}
appJarSha256=${app_jar_sha256}
migrateImage=${new_migrate_image}
proxyImage=${new_proxy_image}
databaseImage=${database_image}
schemaVersion=${schema_version}
environmentSha256=${env_sha256}
EOF
compose_at "${release_directory}" ps
echo "持续更新完成：${old_revision} -> ${commit}"
trap - EXIT
