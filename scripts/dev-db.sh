#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/lib/dev-database.sh"
configure_dev_database
validate_dev_database_configuration
require_dev_database_tools

usage() {
  echo "用法: npm run dev:db -- {start|stop|status}" >&2
}

command_name="${1:-}"
case "${command_name}" in
  start)
    database_started_here=false
    cleanup_failed_start() {
      local exit_code=$?
      if ((exit_code != 0)) && [[ "${database_started_here}" == true ]]; then
        pg_ctl -D "${DEV_DB_DATA_DIR}" -m fast -w stop >/dev/null 2>&1 || true
      fi
      exit "${exit_code}"
    }
    trap cleanup_failed_start EXIT
    initialize_dev_database_cluster
    if dev_database_is_ready; then
      verify_active_dev_database_cluster
    else
      pg_ctl -D "${DEV_DB_DATA_DIR}" -l "${DEV_DB_LOG_FILE}" \
        -o "-h ${DEV_DB_HOST} -p ${DEV_DB_PORT}" -w start >/dev/null
      database_started_here=true
      verify_active_dev_database_cluster
    fi
    provision_dev_database
    trap - EXIT
    echo "本地 PostgreSQL 已就绪: ${DEV_DB_HOST}:${DEV_DB_PORT}/${DEV_DB_NAME}"
    ;;
  stop)
    if ! dev_database_is_ready; then
      echo "本地 PostgreSQL 未在 ${DEV_DB_HOST}:${DEV_DB_PORT} 运行。"
      exit 0
    fi
    verify_active_dev_database_cluster
    pg_ctl -D "${DEV_DB_DATA_DIR}" -m fast -w stop >/dev/null
    echo "本地 PostgreSQL 已停止；数据保留在 ${DEV_DB_DATA_DIR}。"
    ;;
  status)
    if ! dev_database_is_ready; then
      echo "本地 PostgreSQL 未在 ${DEV_DB_HOST}:${DEV_DB_PORT} 运行。"
      exit 1
    fi
    verify_active_dev_database_cluster
    echo "本地 PostgreSQL 正在运行: ${DEV_DB_HOST}:${DEV_DB_PORT}/${DEV_DB_NAME}"
    ;;
  *)
    usage
    exit 2
    ;;
esac
