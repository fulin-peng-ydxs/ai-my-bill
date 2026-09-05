#!/usr/bin/env bash
set -euo pipefail

# 常驻应用入口：拒绝任何 migration 变量，并只读取运行角色 secret。
if env | grep -q '^MY_BILL_MIGRATION_DB_'; then
  echo "常驻应用环境禁止出现 MY_BILL_MIGRATION_DB_*。" >&2
  exit 1
fi

password_file="${MY_BILL_APP_DB_PASSWORD_FILE:-/run/secrets/app_db_password}"
if [[ ! -r "${password_file}" ]]; then
  echo "应用数据库密码 secret 不可读。" >&2
  exit 1
fi
if [[ -z "${MY_BILL_APP_DB_URL:-}" || -z "${MY_BILL_APP_DB_USERNAME:-}" ]]; then
  echo "应用数据库 URL 或用户名未配置。" >&2
  exit 1
fi

export SPRING_DATASOURCE_URL="${MY_BILL_APP_DB_URL}"
export SPRING_DATASOURCE_USERNAME="${MY_BILL_APP_DB_USERNAME}"
export SPRING_DATASOURCE_PASSWORD="$(<"${password_file}")"
exec java ${JAVA_OPTS:-} -jar /app/my-bill-server.jar --spring.profiles.active=prod
