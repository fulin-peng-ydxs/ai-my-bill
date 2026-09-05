#!/usr/bin/env bash
set -euo pipefail

# 一次性角色初始化入口：三类 secret 只在短生命周期 provision 容器内可见。
admin_password_file="${MY_BILL_POSTGRES_ADMIN_PASSWORD_FILE:-/run/secrets/postgres_admin_password}"
migration_password_file="${MY_BILL_MIGRATION_DB_PASSWORD_FILE:-/run/secrets/migration_db_password}"
app_password_file="${MY_BILL_APP_DB_PASSWORD_FILE:-/run/secrets/app_db_password}"
for password_file in "${admin_password_file}" "${migration_password_file}" "${app_password_file}"; do
  if [[ ! -r "${password_file}" ]]; then
    echo "数据库角色初始化缺少可读 secret。" >&2
    exit 1
  fi
done

export MY_BILL_ROLE_MIGRATION_PASSWORD="$(<"${migration_password_file}")"
export MY_BILL_ROLE_APP_PASSWORD="$(<"${app_password_file}")"
export PGPASSWORD="$(<"${admin_password_file}")"
if [[ -z "${PGPASSWORD}" || -z "${MY_BILL_ROLE_MIGRATION_PASSWORD}" || -z "${MY_BILL_ROLE_APP_PASSWORD}" ]]; then
  echo "数据库角色密码不能为空。" >&2
  exit 1
fi

exec psql --host="${MY_BILL_POSTGRES_HOST:-db}" \
  --username="${MY_BILL_POSTGRES_ADMIN_USERNAME:-my_bill_admin}" \
  --dbname="${POSTGRES_DB:-my_bill}" \
  --set=ON_ERROR_STOP=1 \
  --file=/opt/my-bill/postgres/001_roles.sql
