#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source "${PROJECT_ROOT}/scripts/toolchain.sh"
source "${PROJECT_ROOT}/scripts/lib/dev-database.sh"
resolve_toolchain
configure_dev_database
validate_dev_database_configuration
require_dev_database_tools

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

initialize_dev_database_cluster

if ! dev_database_is_ready; then
  node "${PROJECT_ROOT}/scripts/lib/local-log-runner.mjs" postgres postgres -D "${DEV_DB_DATA_DIR}" -h "${DEV_DB_HOST}" -p "${DEV_DB_PORT}" &
  POSTGRES_PID=$!
  postgres_started=true
  for _ in {1..30}; do
    dev_database_is_ready && break
    if ! kill -0 "${POSTGRES_PID}" 2>/dev/null; then
      echo "PostgreSQL 启动失败，请查看 ${DEV_DB_LOG_FILE}。" >&2
      exit 1
    fi
    sleep 0.2
  done
fi

if ! dev_database_is_ready; then
  echo "PostgreSQL 未在预期时间内就绪，请查看 ${DEV_DB_LOG_FILE}。" >&2
  exit 1
fi

verify_active_dev_database_cluster
provision_dev_database
export_dev_database_environment

cd "${PROJECT_ROOT}"
bash "${PROJECT_ROOT}/scripts/run-backend.sh" &
SERVER_PID=$!
bash "${PROJECT_ROOT}/scripts/run-frontend.sh" dev -- --host "${MY_BILL_WEB_HOST:-0.0.0.0}" &
WEB_PID=$!

echo "本地日志: ${MY_BILL_LOCAL_LOG_ROOT:-${PROJECT_ROOT}/.local/logs}（backend / frontend / postgres）"
echo "前端: http://127.0.0.1:${MY_BILL_WEB_PORT:-5174}"
echo "手机访问: http://<本机局域网IP>:${MY_BILL_WEB_PORT:-5174}（需连接同一局域网）"
echo "健康检查: http://127.0.0.1:${MY_BILL_SERVER_PORT:-8080}/api/v1/health"
while kill -0 "${SERVER_PID}" 2>/dev/null && kill -0 "${WEB_PID}" 2>/dev/null; do
  sleep 1
done
echo "前端或后端进程已退出，正在关闭本次本地开发环境。" >&2
exit 1
