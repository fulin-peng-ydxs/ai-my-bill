#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary="$(mktemp -d)"
cleanup() { rm -rf -- "${temporary}"; }
trap cleanup EXIT

while IFS= read -r -d '' script; do bash -n "${script}"; done < <(find "${PROJECT_ROOT}/scripts" "${PROJECT_ROOT}/deploy" -type f -name '*.sh' -print0)

cat > "${temporary}/sample.env" <<EOF
BILL_TARGET_ID=sample
BILL_DEPLOYMENT_PROFILE=intranet-single-host
BILL_HOST_PROFILE=managed-linux
BILL_HOST_PACKAGE_SOURCE=preconfigured
BILL_HOST_TIMEZONE=Asia/Shanghai
BILL_HOST_FIREWALL_MODE=external
BILL_HOST=192.168.20.10
BILL_SSH_USER=root
BILL_SSH_PORT=22
BILL_IDENTITY_FILE=
BILL_KNOWN_HOSTS_FILE=${temporary}/known_hosts
BILL_REMOTE_ROOT=/opt/my-bill
BILL_ENV_FILE=/etc/my-bill/production.env
BILL_CA_FILE=/etc/my-bill/ca.crt
BILL_HEALTH_URL=https://192.168.20.10:18443/api/v1/health
BILL_BACKUP_SERVICE=my-bill-backup.service
BILL_BACKUP_STATUS_FILE=/var/lib/my-bill/operations/backup.properties
BILL_OFFSITE_BACKUP_DIRECTORY=${temporary}/offsite-backups
BILL_OFFSITE_KEY_DIRECTORY=${temporary}/offsite-keys
BILL_COMPOSE_OVERLAY=deploy/compose.intranet.yaml
BILL_HEALTH_TIMEOUT_SECONDS=180
BILL_BIND_IP=192.168.20.10
BILL_HTTPS_PORT=18443
BILL_ALLOWED_CIDRS=192.168.20.0/24
BILL_TLS_CERT_SOURCE=/tmp/server.crt
BILL_TLS_KEY_SOURCE=/tmp/server.key
BILL_CA_CERT_SOURCE=/tmp/ca.crt
BILL_INITIAL_ADMIN_OUTPUT_FILE=/tmp/initial-admin.json
BILL_ALLOW_EOL_CENTOS7=0
EOF
: > "${temporary}/known_hosts"

PROJECT_UNDER_TEST="${PROJECT_ROOT}" TARGET_UNDER_TEST="${temporary}" bash <<'BASH'
set -euo pipefail
PROJECT_ROOT="${PROJECT_UNDER_TEST}"; TARGET_DIRECTORY="${TARGET_UNDER_TEST}"
fail() { echo "$*" >&2; exit 1; }
source "${PROJECT_ROOT}/scripts/lib/deploy-target.sh"
load_target sample
[[ "${BILL_HOST_PROFILE}" == managed-linux ]]
[[ "${BILL_HOST_PACKAGE_SOURCE}" == preconfigured ]]
[[ "${BILL_HOST_TIMEZONE}" == Asia/Shanghai ]]
[[ "${BILL_HOST_FIREWALL_MODE}" == external ]]
[[ "${BILL_OFFSITE_BACKUP_DIRECTORY}" == "${TARGET_UNDER_TEST}/offsite-backups" ]]
[[ "${BILL_OFFSITE_KEY_DIRECTORY}" == "${TARGET_UNDER_TEST}/offsite-keys" ]]
BASH

cp "${temporary}/sample.env" "${temporary}/malicious.env"
sed -i.bak 's/BILL_TARGET_ID=sample/BILL_TARGET_ID=malicious/' "${temporary}/malicious.env"
printf 'BILL_IDENTITY_FILE=$(touch %s/parser-executed)\n' "${temporary}" >> "${temporary}/malicious.env"
if PROJECT_UNDER_TEST="${PROJECT_ROOT}" TARGET_UNDER_TEST="${temporary}" bash <<'BASH'
set -euo pipefail
PROJECT_ROOT="${PROJECT_UNDER_TEST}"; TARGET_DIRECTORY="${TARGET_UNDER_TEST}"
fail() { exit 1; }
source "${PROJECT_ROOT}/scripts/lib/deploy-target.sh"
load_target malicious
BASH
then
  echo '恶意目标配置应被拒绝。' >&2
  exit 1
fi
[[ ! -e "${temporary}/parser-executed" ]]

cp "${temporary}/sample.env" "${temporary}/unsafe.env"
sed -i.bak 's/BILL_TARGET_ID=sample/BILL_TARGET_ID=unsafe/' "${temporary}/unsafe.env"
printf 'BILL_OFFSITE_BACKUP_DIRECTORY=/\n' >> "${temporary}/unsafe.env"
if PROJECT_UNDER_TEST="${PROJECT_ROOT}" TARGET_UNDER_TEST="${temporary}" bash <<'BASH'
set -euo pipefail
PROJECT_ROOT="${PROJECT_UNDER_TEST}"; TARGET_DIRECTORY="${TARGET_UNDER_TEST}"
fail() { exit 1; }
source "${PROJECT_ROOT}/scripts/lib/deploy-target.sh"
load_target unsafe
BASH
then
  echo '危险的异机根目录应被拒绝。' >&2
  exit 1
fi

for profile in "${PROJECT_ROOT}"/deploy/host-profiles/*.env; do
  awk -F= '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ {next}
    $1 !~ /^(HOST_PROFILE_ID|IMPLEMENTED|MUTATION_ALLOWED|MIN_DOCKER_VERSION|MIN_COMPOSE_VERSION)$/ {exit 1}
    END {if (NR == 0) exit 1}
  ' "${profile}"
done

if bash "${PROJECT_ROOT}/deploy/scripts/prepare-host.sh" --action invalid >/dev/null 2>&1; then
  echo 'prepare-host必须拒绝未知action。' >&2
  exit 1
fi

bash "${PROJECT_ROOT}/scripts/environment.sh" help >/dev/null
bash "${PROJECT_ROOT}/scripts/operations.sh" help >/dev/null
echo 'PASS: 部署目标契约、宿主profile和Shell语法检查通过。'
