#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DIR="${PROJECT_ROOT}/.local"
PG_DATA_DIR="${LOCAL_DIR}/postgres"
PG_LOG_FILE="${LOCAL_DIR}/postgres.log"
DB_HOST="${MY_BILL_DB_HOST:-127.0.0.1}"
DB_PORT="${MY_BILL_DB_PORT:-54329}"
DB_NAME="${MY_BILL_DB_NAME:-my_bill_dev}"
DB_ADMIN_USER="${MY_BILL_DB_ADMIN_USER:-my_bill_dev}"
DB_MIGRATION_USER="${MY_BILL_DB_MIGRATION_USER:-my_bill_migration}"
DB_APP_USER="${MY_BILL_DB_APP_USER:-my_bill_app}"

if [[ "${DB_HOST}" != "127.0.0.1" && "${DB_HOST}" != "localhost" ]]; then
  echo "一键开发环境只允许使用本机 PostgreSQL；外部数据库请单独启动后端。" >&2
  exit 1
fi
if [[ ! "${DB_PORT}" =~ ^[0-9]+$ ]] || ((DB_PORT < 1 || DB_PORT > 65535)); then
  echo "数据库端口必须是 1-65535 的整数。" >&2
  exit 1
fi
if [[ ! "${DB_NAME}" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]]; then
  echo "数据库名仅允许 1-63 位字母、数字、下划线或连字符，且必须以字母或下划线开头。" >&2
  exit 1
fi
for database_user in "${DB_ADMIN_USER}" "${DB_MIGRATION_USER}" "${DB_APP_USER}"; do
  if [[ ! "${database_user}" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]]; then
    echo "数据库用户名仅允许 1-63 位字母、数字、下划线或连字符，且必须以字母或下划线开头。" >&2
    exit 1
  fi
done
if [[ "${DB_MIGRATION_USER}" != "my_bill_migration" || "${DB_APP_USER}" != "my_bill_app" ]]; then
  echo "T2 migration 固定使用 my_bill_migration/my_bill_app 角色，拒绝漂移的本地角色名。" >&2
  exit 1
fi

source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_toolchain

for command_name in initdb postgres pg_isready createdb psql; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "缺少 PostgreSQL 命令 ${command_name}，请安装 PostgreSQL 16 或更高版本。" >&2
    exit 1
  fi
done

postgres_major_version="$(postgres --version | sed -E 's/.* ([0-9]+)([.].*)?$/\1/')"
if [[ ! "${postgres_major_version}" =~ ^[0-9]+$ ]] || ((postgres_major_version < 16)); then
  echo "需要 PostgreSQL 16 或更高版本，当前检测到：$(postgres --version)。" >&2
  exit 1
fi

postgres_started=false
cleanup() {
  local exit_code=$?
  trap - EXIT HUP INT TERM
  kill "${WEB_PID:-}" "${SERVER_PID:-}" 2>/dev/null || true
  if [[ "${postgres_started}" == true ]]; then
    kill -INT "${POSTGRES_PID}" 2>/dev/null || true
  fi
  wait "${WEB_PID:-}" "${SERVER_PID:-}" 2>/dev/null || true
  if [[ "${postgres_started}" == true ]]; then
    wait "${POSTGRES_PID}" 2>/dev/null || true
  fi
  exit "${exit_code}"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "${LOCAL_DIR}"
if [[ ! -s "${PG_DATA_DIR}/PG_VERSION" ]]; then
  initdb -D "${PG_DATA_DIR}" -U "${DB_ADMIN_USER}" --auth=trust --encoding=UTF8 --locale=C >/dev/null
fi

if ! pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" >/dev/null 2>&1; then
  postgres -D "${PG_DATA_DIR}" -h "${DB_HOST}" -p "${DB_PORT}" >"${PG_LOG_FILE}" 2>&1 &
  POSTGRES_PID=$!
  postgres_started=true
  for _ in {1..30}; do
    pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" >/dev/null 2>&1 && break
    if ! kill -0 "${POSTGRES_PID}" 2>/dev/null; then
      echo "PostgreSQL 启动失败，请查看 ${PG_LOG_FILE}。" >&2
      exit 1
    fi
    sleep 0.2
  done
fi

if ! pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" >/dev/null 2>&1; then
  echo "PostgreSQL 未在预期时间内就绪，请查看 ${PG_LOG_FILE}。" >&2
  exit 1
fi

active_pg_data="$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" -d postgres -tAc 'SHOW data_directory')"
active_pg_data="$(cd "${active_pg_data}" && pwd -P)"
expected_pg_data="$(cd "${PG_DATA_DIR}" && pwd -P)"
if [[ "${active_pg_data}" != "${expected_pg_data}" ]]; then
  echo "端口 ${DB_PORT} 已被其他 PostgreSQL 数据集群占用，拒绝复用：${active_pg_data}。" >&2
  exit 1
fi

if ! psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  createdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" "${DB_NAME}"
fi

# 本地 bootstrap 账号只负责建库/建角；Flyway 与应用均使用固定的非超级角色。
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 \
  -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_MIGRATION_USER}') THEN CREATE ROLE \"${DB_MIGRATION_USER}\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_APP_USER}') THEN CREATE ROLE \"${DB_APP_USER}\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END \$\$;" \
  -c "ALTER ROLE \"${DB_MIGRATION_USER}\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS" \
  -c "ALTER ROLE \"${DB_APP_USER}\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS" \
  -c "GRANT CONNECT ON DATABASE \"${DB_NAME}\" TO \"${DB_MIGRATION_USER}\", \"${DB_APP_USER}\"" \
  -c "ALTER SCHEMA public OWNER TO \"${DB_MIGRATION_USER}\"" \
  -c "REVOKE CREATE ON SCHEMA public FROM PUBLIC" >/dev/null

export MY_BILL_DB_HOST="${DB_HOST}"
export MY_BILL_DB_PORT="${DB_PORT}"
export MY_BILL_DB_NAME="${DB_NAME}"
export MY_BILL_DB_MIGRATION_USER="${DB_MIGRATION_USER}"
export MY_BILL_DB_APP_USER="${DB_APP_USER}"

cd "${PROJECT_ROOT}"
./mvnw -q -pl server spring-boot:run &
SERVER_PID=$!
npm --prefix web run dev -- --host 127.0.0.1 &
WEB_PID=$!

echo "前端: http://127.0.0.1:${MY_BILL_WEB_PORT:-5174}"
echo "健康检查: http://127.0.0.1:${MY_BILL_SERVER_PORT:-8080}/api/v1/health"
while kill -0 "${SERVER_PID}" 2>/dev/null && kill -0 "${WEB_PID}" 2>/dev/null; do
  sleep 1
done
echo "前端或后端进程已退出，正在关闭本次本地开发环境。" >&2
exit 1
