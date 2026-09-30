#!/usr/bin/env bash
set -euo pipefail

# 目标机首次环境初始化器。只支持从已校验候选创建新实例；不会安装宿主/Docker、
# 覆盖已有运行配置或删除数据库卷。失败后使用同一提交执行 resume。

fail() { echo "错误：$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || fail "目标主机缺少命令：$1"; }

action=""
commit=""
incoming_dir=""
release_root=""
env_file=""
ca_file=""
health_url=""
compose_overlay=""
profile=""
bind_ip=""
https_port=""
allowed_cidrs=""
health_timeout="180"
allow_eol_centos7="0"

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --action) action="${2:-}"; shift 2 ;;
    --commit) commit="${2:-}"; shift 2 ;;
    --incoming-dir) incoming_dir="${2:-}"; shift 2 ;;
    --release-root) release_root="${2:-}"; shift 2 ;;
    --env-file) env_file="${2:-}"; shift 2 ;;
    --ca-file) ca_file="${2:-}"; shift 2 ;;
    --health-url) health_url="${2:-}"; shift 2 ;;
    --compose-overlay) compose_overlay="${2:-}"; shift 2 ;;
    --profile) profile="${2:-}"; shift 2 ;;
    --bind-ip) bind_ip="${2:-}"; shift 2 ;;
    --https-port) https_port="${2:-}"; shift 2 ;;
    --allowed-cidrs) allowed_cidrs="${2:-}"; shift 2 ;;
    --health-timeout) health_timeout="${2:-}"; shift 2 ;;
    --allow-eol-centos7) allow_eol_centos7="${2:-}"; shift 2 ;;
    *) fail "未知参数：$1" ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || fail "首次环境初始化必须由 root 执行"
[[ "${action}" == bootstrap || "${action}" == resume || "${action}" == verify || "${action}" == status || "${action}" == finalize ]] || fail "action 不合法"
[[ "${profile}" == intranet-single-host ]] || fail "部署模式 ${profile} 尚未实现；当前只支持 intranet-single-host"
[[ "${commit}" =~ ^[0-9a-f]{40}$ ]] || fail "commit 必须是完整 Git SHA"
for path in "${incoming_dir}" "${release_root}" "${env_file}" "${ca_file}"; do
  [[ "${path}" == /* ]] || fail "路径必须为绝对路径：${path}"
done
[[ "${health_url}" == https://* && "${health_url}" != *[$'\r\n\t ']* ]] || fail "健康地址必须是 HTTPS"
[[ "${compose_overlay}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ && "${compose_overlay}" != *".."* ]] || fail "Compose 覆盖路径不合法"
[[ "${https_port}" =~ ^[0-9]+$ && "${https_port}" -ge 1024 && "${https_port}" -le 65535 ]] || fail "HTTPS端口不合法"
[[ "${health_timeout}" =~ ^[0-9]+$ && "${health_timeout}" -ge 30 && "${health_timeout}" -le 900 ]] || fail "健康等待秒数不合法"
[[ "${allow_eol_centos7}" == 0 || "${allow_eol_centos7}" == 1 ]] || fail "CentOS7例外值不合法"
[[ -n "${allowed_cidrs}" && "${allowed_cidrs}" != *$'\n'* ]] || fail "允许网段不能为空"

for command in awk cmp curl date docker grep install openssl python sha256sum systemctl tar; do require_command "${command}"; done
python -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 8) else 1)' || fail "目标主机的 python 必须是 Python 3.8+"
python - "${bind_ip}" "${allowed_cidrs}" <<'PY'
import ipaddress,sys
address=ipaddress.ip_address(sys.argv[1])
private_networks=[ipaddress.ip_network(value) for value in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')]
if address.version != 4 or not any(address in network for network in private_networks):
    raise SystemExit('绑定IP必须是RFC1918内网IPv4')
values=sys.argv[2].split()
if not values:
    raise SystemExit('允许网段不能为空')
for value in values:
    ipaddress.ip_network(value, strict=False)
PY

operations_root=/var/lib/my-bill/operations
state_file="${operations_root}/environment-bootstrap.properties"
secrets_directory=/etc/my-bill/secrets
tls_directory=/etc/my-bill/tls
backup_root=/var/backups/my-bill
current_path="${release_root}/current"

declare -A step_rank=(
  [NONE]=0 [PREPARED]=10 [SECRETS]=20 [TLS]=30 [IMAGES]=40 [DB]=50
  [ROLES]=60 [SCHEMA]=70 [ADMIN]=80 [CURRENT]=90 [APP]=100 [PROXY]=110
  [BACKUP]=120 [COMPLETE]=130 [FINALIZED]=140
)

current_step=NONE
state_commit=""
if [[ -f "${state_file}" ]]; then
  current_step="$(awk -F= '$1 == "step" {print $2}' "${state_file}")"
  state_commit="$(awk -F= '$1 == "commit" {print $2}' "${state_file}")"
  [[ -n "${step_rank[${current_step}]+x}" ]] || fail "初始化状态包含未知步骤：${current_step}"
  [[ "${state_commit}" == "${commit}" ]] || fail "初始化状态属于 ${state_commit}，当前候选为 ${commit}"
  [[ "$(awk -F= '$1 == "profile" {print substr($0,index($0,"=")+1)}' "${state_file}")" == "${profile}" ]] || fail "初始化状态的部署模式不匹配"
  [[ "$(awk -F= '$1 == "releaseRoot" {print substr($0,index($0,"=")+1)}' "${state_file}")" == "${release_root}" ]] || fail "初始化状态的发布根不匹配"
  [[ "$(awk -F= '$1 == "envFile" {print substr($0,index($0,"=")+1)}' "${state_file}")" == "${env_file}" ]] || fail "初始化状态的运行配置路径不匹配"
  [[ "$(awk -F= '$1 == "caFile" {print substr($0,index($0,"=")+1)}' "${state_file}")" == "${ca_file}" ]] || fail "初始化状态的CA路径不匹配"
  [[ "$(awk -F= '$1 == "healthUrl" {print substr($0,index($0,"=")+1)}' "${state_file}")" == "${health_url}" ]] || fail "初始化状态的健康地址不匹配"
  [[ "$(awk -F= '$1 == "composeOverlay" {print substr($0,index($0,"=")+1)}' "${state_file}")" == "${compose_overlay}" ]] || fail "初始化状态的Compose覆盖不匹配"
  [[ "$(awk -F= '$1 == "bindIp" {print substr($0,index($0,"=")+1)}' "${state_file}")" == "${bind_ip}" ]] || fail "初始化状态的绑定IP不匹配"
  [[ "$(awk -F= '$1 == "httpsPort" {print substr($0,index($0,"=")+1)}' "${state_file}")" == "${https_port}" ]] || fail "初始化状态的HTTPS端口不匹配"
  [[ "$(awk -F= '$1 == "allowedCidrs" {print substr($0,index($0,"=")+1)}' "${state_file}")" == "${allowed_cidrs}" ]] || fail "初始化状态的允许网段不匹配"
fi

step_done() { (( step_rank[${current_step}] >= step_rank[$1] )); }
record_step() {
  local step="$1" temporary
  install -d -m 0755 -o root -g root "${operations_root}"
  temporary="$(mktemp "${operations_root}/.environment-bootstrap.XXXXXX")"
  printf 'profile=%s\ncommit=%s\nstep=%s\nreleaseRoot=%s\nenvFile=%s\ncaFile=%s\nhealthUrl=%s\ncomposeOverlay=%s\nbindIp=%s\nhttpsPort=%s\nallowedCidrs=%s\nupdatedAt=%s\n' \
    "${profile}" "${commit}" "${step}" "${release_root}" "${env_file}" "${ca_file}" "${health_url}" \
    "${compose_overlay}" "${bind_ip}" "${https_port}" "${allowed_cidrs}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "${temporary}"
  chmod 0600 "${temporary}"
  mv -f "${temporary}" "${state_file}"
  current_step="${step}"
}

compose_at() {
  local directory="$1"; shift
  (cd "${directory}" && docker compose --env-file "${env_file}" -f deploy/compose.yaml -f "${compose_overlay}" "$@")
}

wait_for_health() {
  local service="$1" deadline status
  deadline=$((SECONDS + health_timeout))
  while (( SECONDS < deadline )); do
    status="$(docker inspect "my-bill-${service}-1" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
    [[ "${status}" == healthy || "${service}" == proxy && "${status}" == running ]] && return 0
    sleep 3
  done
  fail "${service} 未在 ${health_timeout} 秒内就绪"
}

show_status() {
  echo "profile=${profile}"
  echo "commit=${state_commit:-none}"
  echo "step=${current_step}"
  if [[ -e "${current_path}" && -f "${env_file}" ]]; then
    compose_at "$(cd "${current_path}" && pwd -P)" ps || true
  fi
}

verify_environment() {
  local current_revision
  step_done COMPLETE || fail "环境尚未完成初始化，当前步骤：${current_step}"
  current_revision="$(cat "${current_path}/REVISION" 2>/dev/null || true)"
  [[ "${current_revision}" =~ ^[0-9a-f]{40}$ ]] || fail "current版本记录不合法"
  [[ -f "${ca_file}" ]] || fail "CA公钥不存在"
  compose_at "$(cd "${current_path}" && pwd -P)" config --quiet
  [[ "$(docker inspect my-bill-db-1 --format '{{.State.Health.Status}}')" == healthy ]] || fail "db不健康"
  [[ "$(docker inspect my-bill-app-1 --format '{{.State.Health.Status}}')" == healthy ]] || fail "app不健康"
  [[ "$(docker inspect my-bill-proxy-1 --format '{{.State.Status}}')" == running ]] || fail "proxy未运行"
  curl --fail --silent --show-error --cacert "${ca_file}" "${health_url}" >/dev/null
  systemctl is-enabled my-bill-backup.timer >/dev/null
  systemctl is-enabled my-bill-monitor.timer >/dev/null
  [[ "$(awk -F= '$1 == "status" {print $2}' "${operations_root}/backup.properties" 2>/dev/null || true)" == SUCCEEDED ]] || fail "首次备份未成功"
  echo "环境基础验收通过：初始化提交 ${commit}，当前运行 ${current_revision}；仍需人工完成首登改密、角色/租户和目标终端PWA验收。"
}

case "${action}" in
  status) show_status; exit 0 ;;
  verify) verify_environment; exit 0 ;;
  finalize)
    step_done COMPLETE || fail "环境尚未完成，不能finalize"
    [[ -f "${secrets_directory}/initial_admin_password" ]] || { record_step FINALIZED; echo "服务器初始管理员密码副本已不存在。"; exit 0; }
    rm "${secrets_directory}/initial_admin_password"
    record_step FINALIZED
    echo "已删除服务器初始管理员密码副本。"
    exit 0
    ;;
esac

[[ "${incoming_dir}" == "${release_root}/incoming/${commit}" ]] || fail "接收目录不属于本次候选"
for file in source.tar web-dist.tar.gz manifest.txt bootstrap-environment.sh preflight-host.sh build.properties SHA256SUMS; do
  [[ -f "${incoming_dir}/${file}" ]] || fail "交付文件缺失：${file}"
done
[[ -f "${incoming_dir}/tls/server.crt" && -f "${incoming_dir}/tls/server.key" && -f "${incoming_dir}/tls/ca.crt" ]] || fail "内网TLS交付文件不完整"

if [[ "${action}" == bootstrap ]]; then
  [[ "${current_step}" == NONE ]] || fail "目标已有初始化状态 ${current_step}，请使用 resume"
  [[ ! -e "${current_path}" ]] || fail "目标已有 current；首次初始化拒绝覆盖"
elif [[ "${current_step}" == NONE ]]; then
  fail "没有可续跑的初始化状态"
fi

echo "[1/12] 校验候选与主机"
(cd "${incoming_dir}" && sha256sum -c SHA256SUMS)
grep -Fqx "commit=${commit}" "${incoming_dir}/build.properties" || fail "构建记录与提交不一致"
for archive in source.tar web-dist.tar.gz; do
  archive_mode=(-tf)
  [[ "${archive}" == *.gz ]] && archive_mode=(-tzf)
  while IFS= read -r entry; do
    case "${entry}" in /*|../*|*/../*|*/..|..) fail "归档包含越界路径：${entry}" ;; esac
  done < <(tar "${archive_mode[@]}" "${incoming_dir}/${archive}")
done

release_directory="${release_root}/releases/${commit}"
if ! step_done PREPARED; then
  MY_BILL_ALLOW_EOL_CENTOS7="${allow_eol_centos7}" bash "${incoming_dir}/preflight-host.sh" "${bind_ip}" "${https_port}"
  # 在第一项持久化改动前登记归属，使SSH中断后可以用同一提交resume，
  # 同时仍能把没有状态文件的既有目录判为未知环境并拒绝接管。
  [[ -f "${state_file}" ]] || record_step NONE
  install -d -m 0750 "${release_root}/releases"
  if [[ ! -d "${release_directory}" ]]; then
    staging_directory="$(mktemp -d "${release_root}/releases/.${commit}.staging.XXXXXX")"
    tar --no-same-owner -xf "${incoming_dir}/source.tar" -C "${staging_directory}"
    tar --no-same-owner -xzf "${incoming_dir}/web-dist.tar.gz" -C "${staging_directory}"
    printf '%s\n' "${commit}" > "${staging_directory}/REVISION"
    chown -R root:root "${staging_directory}"
    mv "${staging_directory}" "${release_directory}"
  else
    [[ "$(cat "${release_directory}/REVISION" 2>/dev/null || true)" == "${commit}" ]] || fail "已有候选目录版本不匹配"
  fi
  install -d -m 0700 /etc/my-bill "${secrets_directory}" "${tls_directory}"
  if [[ ! -e "${env_file}" ]]; then
    install -m 0600 "${release_directory}/deploy/env/production.env.example" "${env_file}"
    python - "${env_file}" "${bind_ip}" "${https_port}" "${allowed_cidrs}" "${release_root}" <<'PY'
import pathlib,sys
path=pathlib.Path(sys.argv[1]); values={
 "MY_BILL_BIND_IP":sys.argv[2],"MY_BILL_HTTPS_PORT":sys.argv[3],
 "MY_BILL_ALLOWED_CIDRS":sys.argv[4],"MY_BILL_WEB_DIST":sys.argv[5]+"/current/web/dist",
 "MY_BILL_TLS_DIRECTORY":"/etc/my-bill/tls"}
lines=[]; seen=set()
for line in path.read_text().splitlines():
    key=line.split("=",1)[0] if "=" in line and not line.startswith("#") else None
    if key in values: lines.append(key+"="+values[key]); seen.add(key)
    else: lines.append(line)
for key,value in values.items():
    if key not in seen: lines.append(key+"="+value)
path.write_text("\n".join(lines)+"\n")
PY
  else
    grep -Fqx "MY_BILL_BIND_IP=${bind_ip}" "${env_file}" || fail "已有运行配置的绑定IP不匹配"
    grep -Fqx "MY_BILL_HTTPS_PORT=${https_port}" "${env_file}" || fail "已有运行配置的HTTPS端口不匹配"
    grep -Fqx "MY_BILL_ALLOWED_CIDRS=${allowed_cidrs}" "${env_file}" || fail "已有运行配置的允许网段不匹配"
    grep -Fqx "MY_BILL_WEB_DIST=${release_root}/current/web/dist" "${env_file}" || fail "已有运行配置的dist路径不匹配"
  fi
  record_step PREPARED
else
  [[ -d "${release_directory}" && -f "${env_file}" ]] || fail "PREPARED状态与实际文件不一致"
fi

echo "[2/12] 准备运行secret（只创建缺失文件）"
if ! step_done SECRETS; then
  if docker volume inspect my-bill_postgres_data >/dev/null 2>&1; then
    for name in postgres_admin_password migration_db_password app_db_password auth_rate_limit_pepper initial_admin_password; do
      [[ -f "${secrets_directory}/${name}" ]] || fail "数据库卷已存在但secret ${name} 缺失，拒绝生成新值"
    done
  fi
  umask 077
  for name in postgres_admin_password migration_db_password app_db_password auth_rate_limit_pepper initial_admin_password; do
    if [[ ! -e "${secrets_directory}/${name}" ]]; then
      (set -o noclobber; openssl rand -base64 32 > "${secrets_directory}/${name}")
    fi
  done
  chown root:root "${secrets_directory}/postgres_admin_password"
  chown 10001:10001 "${secrets_directory}/migration_db_password" "${secrets_directory}/app_db_password" \
    "${secrets_directory}/auth_rate_limit_pepper" "${secrets_directory}/initial_admin_password"
  chmod 0600 "${secrets_directory}/postgres_admin_password" "${secrets_directory}/migration_db_password" \
    "${secrets_directory}/app_db_password" "${secrets_directory}/auth_rate_limit_pepper" \
    "${secrets_directory}/initial_admin_password"
  record_step SECRETS
fi

echo "[3/12] 校验并安装内网叶证书"
if ! step_done TLS; then
  openssl verify -CAfile "${incoming_dir}/tls/ca.crt" -verify_ip "${bind_ip}" "${incoming_dir}/tls/server.crt" >/dev/null
  openssl x509 -in "${incoming_dir}/tls/server.crt" -checkend 86400 -noout >/dev/null
  cert_public="$(openssl x509 -in "${incoming_dir}/tls/server.crt" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | awk '{print $1}')"
  key_public="$(openssl pkey -in "${incoming_dir}/tls/server.key" -pubout -outform DER | sha256sum | awk '{print $1}')"
  [[ "${cert_public}" == "${key_public}" ]] || fail "叶证书与私钥不匹配"
  if [[ ! -e "${tls_directory}/server.crt" && ! -e "${tls_directory}/server.key" && ! -e "${ca_file}" ]]; then
    install -o 10001 -g 10001 -m 0644 "${incoming_dir}/tls/server.crt" "${tls_directory}/server.crt"
    install -o 10001 -g 10001 -m 0600 "${incoming_dir}/tls/server.key" "${tls_directory}/server.key"
    install -o root -g root -m 0644 "${incoming_dir}/tls/ca.crt" "${ca_file}"
  elif [[ -f "${tls_directory}/server.crt" && -f "${tls_directory}/server.key" && -f "${ca_file}" ]]; then
    cmp -s "${incoming_dir}/tls/server.crt" "${tls_directory}/server.crt" || fail "已有叶证书与本次材料不一致"
    cmp -s "${incoming_dir}/tls/server.key" "${tls_directory}/server.key" || fail "已有叶私钥与本次材料不一致"
    cmp -s "${incoming_dir}/tls/ca.crt" "${ca_file}" || fail "已有CA公钥与本次材料不一致"
  else
    fail "TLS目标文件处于不完整状态，拒绝覆盖"
  fi
  record_step TLS
fi

echo "[4/12] 校验Compose并构建镜像"
compose_at "${release_directory}" config --quiet
if ! step_done IMAGES; then
  compose_at "${release_directory}" build --pull db app migrate proxy
  record_step IMAGES
fi

echo "[5/12] 启动数据库"
if ! step_done DB; then compose_at "${release_directory}" up -d db; wait_for_health db; record_step DB; else wait_for_health db; fi

echo "[6/12] 初始化数据库角色"
if ! step_done ROLES; then compose_at "${release_directory}" run --rm --no-deps -T provision < /dev/null; record_step ROLES; fi

echo "[7/12] 执行数据库迁移"
if ! step_done SCHEMA; then compose_at "${release_directory}" run --rm --no-deps -T migrate < /dev/null; record_step SCHEMA; fi

echo "[8/12] 初始化首管理员"
if ! step_done ADMIN; then
  admin_count="$(docker exec my-bill-db-1 psql -U my_bill_admin -d my_bill -Atc "select count(*) from app_user where role='ADMIN' and tenant_id is null" 2>/dev/null || echo invalid)"
  if [[ "${admin_count}" == 0 ]]; then
    (cd "${release_directory}" && docker compose --env-file "${env_file}" -f deploy/compose.yaml -f "${compose_overlay}" -f deploy/compose.bootstrap.yaml run --rm --no-deps -T bootstrap-admin < /dev/null)
  elif [[ "${admin_count}" != 1 ]]; then
    fail "账号库不是可确认的首次初始化状态（管理员数=${admin_count}）"
  fi
  record_step ADMIN
fi

echo "[9/12] 切换首次current"
if ! step_done CURRENT; then
  if [[ ! -e "${current_path}" ]]; then ln -s "${release_directory}" "${current_path}"; fi
  [[ "$(cd "${current_path}" && pwd -P)" == "${release_directory}" ]] || fail "已有current不属于本次初始化"
  record_step CURRENT
fi
[[ "$(cd "${current_path}" && pwd -P)" == "${release_directory}" ]] || fail "current未指向本次候选"

echo "[10/12] 启动应用与HTTPS入口"
if ! step_done APP; then compose_at "${release_directory}" up -d app; wait_for_health app; record_step APP; else wait_for_health app; fi
if ! step_done PROXY; then compose_at "${release_directory}" up -d proxy; wait_for_health proxy; record_step PROXY; else wait_for_health proxy; fi
curl --fail --silent --show-error --cacert "${ca_file}" "${health_url}" >/dev/null

echo "[11/12] 建立加密备份和本机巡检"
if ! step_done BACKUP; then
  install -d -m 0700 "${backup_root}"; install -d -m 0755 "${operations_root}"
  if [[ ! -e /etc/my-bill/backup-encryption.key && ! -e /etc/my-bill/backup-encryption.crt ]]; then
    openssl req -new -x509 -newkey rsa:3072 -nodes -days 3650 -subj '/CN=My Bill Backup Encryption' \
      -keyout /etc/my-bill/backup-encryption.key -out /etc/my-bill/backup-encryption.crt >/dev/null 2>&1
    chmod 0600 /etc/my-bill/backup-encryption.key /etc/my-bill/backup-encryption.crt
  elif [[ ! -f /etc/my-bill/backup-encryption.key || ! -f /etc/my-bill/backup-encryption.crt ]]; then
    fail "备份加密密钥材料不完整，拒绝覆盖"
  fi
  install -o root -g root -m 0644 "${release_directory}/deploy/systemd/my-bill-backup.service" /etc/systemd/system/my-bill-backup.service
  install -o root -g root -m 0644 "${release_directory}/deploy/systemd/my-bill-backup.timer" /etc/systemd/system/my-bill-backup.timer
  install -o root -g root -m 0644 "${release_directory}/deploy/systemd/my-bill-monitor.service" /etc/systemd/system/my-bill-monitor.service
  install -o root -g root -m 0644 "${release_directory}/deploy/systemd/my-bill-monitor.timer" /etc/systemd/system/my-bill-monitor.timer
  systemctl daemon-reload
  systemctl start my-bill-backup.service
  [[ "$(systemctl show my-bill-backup.service -p Result --value)" == success ]] || fail "首次备份失败"
  systemctl enable --now my-bill-backup.timer my-bill-monitor.timer
  systemctl start my-bill-monitor.service
  [[ "$(systemctl show my-bill-monitor.service -p Result --value)" == success ]] || fail "首次巡检失败"
  record_step BACKUP
fi

echo "[12/12] 基础验收"
record_step COMPLETE
verify_environment
rm -r -- "${incoming_dir}/tls"
