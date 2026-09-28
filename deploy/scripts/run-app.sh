#!/usr/bin/env bash
set -euo pipefail

# 唯一受控维护参数；不接受任意 Spring 参数或命令注入。
[[ $# == 0 || $# == 1 && "$1" == --recovery-tool ]] || exit 2
# 常驻应用入口：拒绝任何 migration 变量，并只读取运行角色 secret。
# 使用变量名循环避免 pipefail 与 grep 提前退出组合时漏判超大环境中的敏感变量。
while IFS= read -r environment_name; do
  if [[ "${environment_name}" == MY_BILL_RECOVERY_* && "${1:-}" != --recovery-tool ]]; then
    echo "常驻应用禁止携带恢复维护参数。" >&2
    exit 1
  fi
  if [[ "${environment_name}" == MY_BILL_BOOTSTRAP_* ]]; then
    echo "常驻应用禁止携带初始化凭据。" >&2
    exit 1
  fi
  if [[ "${environment_name}" == MY_BILL_E2E_* ]]; then
    echo "生产应用禁止出现 MY_BILL_E2E_*。" >&2
    exit 1
  fi
  if [[ "${environment_name}" == MY_BILL_MIGRATION_DB_* ]]; then
    echo "常驻应用环境禁止出现 MY_BILL_MIGRATION_DB_*。" >&2
    exit 1
  fi
done < <(compgen -e)

password_file="${MY_BILL_APP_DB_PASSWORD_FILE:-/run/secrets/app_db_password}"
auth_pepper_file="${MY_BILL_AUTH_RATE_LIMIT_PEPPER_FILE:-/run/secrets/auth_rate_limit_pepper}"
if [[ ! -r "${password_file}" ]]; then
  echo "应用数据库密码 secret 不可读。" >&2
  exit 1
fi
if [[ ! -r "${auth_pepper_file}" ]]; then
  echo "认证限流 pepper secret 不可读。" >&2
  exit 1
fi
if [[ -z "${MY_BILL_APP_DB_URL:-}" || -z "${MY_BILL_APP_DB_USERNAME:-}" ]]; then
  echo "应用数据库 URL 或用户名未配置。" >&2
  exit 1
fi

app_password="$(<"${password_file}")"
if [[ -z "${app_password}" ]]; then
  echo "应用数据库密码 secret 不能为空。" >&2
  exit 1
fi
auth_pepper="$(<"${auth_pepper_file}")"
if [[ ${#auth_pepper} -lt 32 ]]; then
  echo "认证限流 pepper secret 至少需要 32 个字符。" >&2
  exit 1
fi
export SPRING_DATASOURCE_URL="${MY_BILL_APP_DB_URL}"
export SPRING_DATASOURCE_USERNAME="${MY_BILL_APP_DB_USERNAME}"
export SPRING_DATASOURCE_PASSWORD="${app_password}"
java_options=()
if [[ -n "${JAVA_OPTS:-}" ]]; then
  read -r -a java_options <<<"${JAVA_OPTS}"
fi
exec java "${java_options[@]}" -jar /app/my-bill-server.jar --spring.profiles.active=prod "$@"
