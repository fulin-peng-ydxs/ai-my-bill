#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DIR="${PROJECT_ROOT}/.local"
PG_DATA_DIR="${LOCAL_DIR}/postgres"
PG_LOG_FILE="${LOCAL_DIR}/postgres.log"
DB_HOST="${MY_BILL_DB_HOST:-127.0.0.1}"
DB_PORT="${MY_BILL_DB_PORT:-54329}"
DB_NAME="${MY_BILL_DB_NAME:-my_bill_dev}"
DB_USER="${MY_BILL_DB_USER:-my_bill_dev}"

if [[ ! "${DB_NAME}" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]]; then
  echo "数据库名仅允许 1-63 位字母、数字、下划线或连字符，且必须以字母或下划线开头。" >&2
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

mkdir -p "${LOCAL_DIR}"
if [[ ! -s "${PG_DATA_DIR}/PG_VERSION" ]]; then
  initdb -D "${PG_DATA_DIR}" -U "${DB_USER}" --auth=trust --encoding=UTF8 --locale=C >/dev/null
fi

postgres_started=false
if ! pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" >/dev/null 2>&1; then
  postgres -D "${PG_DATA_DIR}" -h "${DB_HOST}" -p "${DB_PORT}" >"${PG_LOG_FILE}" 2>&1 &
  POSTGRES_PID=$!
  postgres_started=true
  for _ in {1..30}; do
    pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" >/dev/null 2>&1 && break
    if ! kill -0 "${POSTGRES_PID}" 2>/dev/null; then
      echo "PostgreSQL 启动失败，请查看 ${PG_LOG_FILE}。" >&2
      exit 1
    fi
    sleep 0.2
  done
fi

if ! psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  createdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${DB_NAME}"
fi

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

export MY_BILL_DB_HOST="${DB_HOST}"
export MY_BILL_DB_PORT="${DB_PORT}"
export MY_BILL_DB_NAME="${DB_NAME}"
export MY_BILL_DB_USER="${DB_USER}"

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
