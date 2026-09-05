#!/usr/bin/env bash
set -euo pipefail

# 一次性 migration 容器入口；密码只通过短生命周期环境传给 Flyway 子进程。
password_file="${MY_BILL_MIGRATION_DB_PASSWORD_FILE:-/run/secrets/migration_db_password}"
if [[ ! -r "${password_file}" ]]; then
  echo "迁移密码 secret 不可读。" >&2
  exit 1
fi
if [[ -z "${MY_BILL_MIGRATION_DB_URL:-}" || -z "${MY_BILL_MIGRATION_DB_USERNAME:-}" ]]; then
  echo "迁移数据库 URL 或用户名未配置。" >&2
  exit 1
fi

migration_password="$(<"${password_file}")"
if [[ -z "${migration_password}" ]]; then
  echo "迁移密码 secret 不能为空。" >&2
  exit 1
fi
export FLYWAY_URL="${MY_BILL_MIGRATION_DB_URL}"
export FLYWAY_USER="${MY_BILL_MIGRATION_DB_USERNAME}"
export FLYWAY_PASSWORD="${migration_password}"
export FLYWAY_LOCATIONS="filesystem:/flyway/sql"
exec flyway -connectRetries=30 -validateMigrationNaming=true migrate
