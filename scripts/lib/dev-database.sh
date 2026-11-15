#!/usr/bin/env bash

# 本文件只提供本地开发数据库的共享函数，由 dev.sh 和 dev-db.sh source。
# 调用方必须先设置 PROJECT_ROOT，并自行决定数据库进程的前后台生命周期。

configure_dev_database() {
  : "${PROJECT_ROOT:?PROJECT_ROOT must be set before loading dev database configuration}"
  DEV_DB_LOCAL_DIR="${PROJECT_ROOT}/.local/web"
  DEV_DB_DATA_DIR="${DEV_DB_LOCAL_DIR}/postgres"
  DEV_DB_LOG_FILE="${MY_BILL_LOCAL_LOG_ROOT:-${DEV_DB_LOCAL_DIR}/logs}/postgres"
  # SQL/error DETAIL can contain ledger values even when the application logs are sanitized.
  DEV_DB_LOG_OPTIONS=(-c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse
    -c log_parameter_max_length=0 -c log_parameter_max_length_on_error=0)
  DEV_DB_HOST="${MY_BILL_DB_HOST:-127.0.0.1}"
  DEV_DB_PORT="${MY_BILL_DB_PORT:-54329}"
  DEV_DB_NAME="${MY_BILL_DB_NAME:-my_bill_dev}"
  DEV_DB_ADMIN_USER="${MY_BILL_DB_ADMIN_USER:-my_bill_dev}"
  DEV_DB_MIGRATION_USER="${MY_BILL_DB_MIGRATION_USER:-my_bill_migration}"
  DEV_DB_APP_USER="${MY_BILL_DB_APP_USER:-my_bill_app}"
}

validate_dev_database_configuration() {
  if [[ "${DEV_DB_HOST}" != "127.0.0.1" && "${DEV_DB_HOST}" != "localhost" ]]; then
    echo "开发数据库管理脚本只允许使用本机 PostgreSQL；外部数据库请由其所属环境管理。" >&2
    return 1
  fi
  if [[ ! "${DEV_DB_PORT}" =~ ^[0-9]+$ ]] || ((DEV_DB_PORT < 1 || DEV_DB_PORT > 65535)); then
    echo "数据库端口必须是 1-65535 的整数。" >&2
    return 1
  fi
  if [[ ! "${DEV_DB_NAME}" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]]; then
    echo "数据库名仅允许 1-63 位字母、数字、下划线或连字符，且必须以字母或下划线开头。" >&2
    return 1
  fi
  local database_user
  for database_user in "${DEV_DB_ADMIN_USER}" "${DEV_DB_MIGRATION_USER}" "${DEV_DB_APP_USER}"; do
    if [[ ! "${database_user}" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]]; then
      echo "数据库用户名仅允许 1-63 位字母、数字、下划线或连字符，且必须以字母或下划线开头。" >&2
      return 1
    fi
  done
  if [[ "${DEV_DB_MIGRATION_USER}" != "my_bill_migration" || "${DEV_DB_APP_USER}" != "my_bill_app" ]]; then
    echo "开发迁移固定使用 my_bill_migration/my_bill_app 角色，拒绝漂移的本地角色名。" >&2
    return 1
  fi
}

require_dev_database_tools() {
  local command_name
  for command_name in initdb postgres pg_ctl pg_isready createdb psql; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      echo "缺少 PostgreSQL 命令 ${command_name}，请安装 PostgreSQL 16 或更高版本。" >&2
      return 1
    fi
  done

  local postgres_major_version
  postgres_major_version="$(postgres --version | sed -E 's/.* ([0-9]+)([.].*)?$/\1/')"
  if [[ ! "${postgres_major_version}" =~ ^[0-9]+$ ]] || ((postgres_major_version < 16)); then
    echo "需要 PostgreSQL 16 或更高版本，当前检测到：$(postgres --version)。" >&2
    return 1
  fi
}

initialize_dev_database_cluster() {
  mkdir -p "${DEV_DB_LOCAL_DIR}"
  if [[ ! -s "${DEV_DB_DATA_DIR}/PG_VERSION" ]]; then
    initdb -D "${DEV_DB_DATA_DIR}" -U "${DEV_DB_ADMIN_USER}" --auth=trust --encoding=UTF8 --locale=C >/dev/null
  fi
}

dev_database_is_ready() {
  pg_isready -h "${DEV_DB_HOST}" -p "${DEV_DB_PORT}" -U "${DEV_DB_ADMIN_USER}" >/dev/null 2>&1
}

verify_active_dev_database_cluster() {
  local active_pg_data expected_pg_data
  active_pg_data="$(psql -h "${DEV_DB_HOST}" -p "${DEV_DB_PORT}" -U "${DEV_DB_ADMIN_USER}" -d postgres -tAc 'SHOW data_directory')"
  active_pg_data="$(cd "${active_pg_data}" && pwd -P)"
  expected_pg_data="$(cd "${DEV_DB_DATA_DIR}" && pwd -P)"
  if [[ "${active_pg_data}" != "${expected_pg_data}" ]]; then
    echo "端口 ${DEV_DB_PORT} 已被其他 PostgreSQL 数据集群占用，拒绝复用：${active_pg_data}。" >&2
    return 1
  fi
}

provision_dev_database() {
  # DEV_DB_NAME 经过严格标识符校验，不允许引号或其他 SQL 元字符。
  if ! psql -h "${DEV_DB_HOST}" -p "${DEV_DB_PORT}" -U "${DEV_DB_ADMIN_USER}" -d postgres \
    -tAc "SELECT 1 FROM pg_database WHERE datname = '${DEV_DB_NAME}'" | grep -q 1; then
    createdb -h "${DEV_DB_HOST}" -p "${DEV_DB_PORT}" -U "${DEV_DB_ADMIN_USER}" "${DEV_DB_NAME}"
  fi

  # 本地管理账号只负责建库/建角；Flyway 与应用均使用固定的非超级角色。
  psql -h "${DEV_DB_HOST}" -p "${DEV_DB_PORT}" -U "${DEV_DB_ADMIN_USER}" -d "${DEV_DB_NAME}" -v ON_ERROR_STOP=1 \
    -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DEV_DB_MIGRATION_USER}') THEN CREATE ROLE \"${DEV_DB_MIGRATION_USER}\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DEV_DB_APP_USER}') THEN CREATE ROLE \"${DEV_DB_APP_USER}\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END \$\$;" \
    -c "ALTER ROLE \"${DEV_DB_MIGRATION_USER}\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS" \
    -c "ALTER ROLE \"${DEV_DB_APP_USER}\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS" \
    -c "GRANT CONNECT ON DATABASE \"${DEV_DB_NAME}\" TO \"${DEV_DB_MIGRATION_USER}\", \"${DEV_DB_APP_USER}\"" \
    -c "ALTER SCHEMA public OWNER TO \"${DEV_DB_MIGRATION_USER}\"" \
    -c "REVOKE CREATE ON SCHEMA public FROM PUBLIC" >/dev/null
}

export_dev_database_environment() {
  export MY_BILL_DB_HOST="${DEV_DB_HOST}"
  export MY_BILL_DB_PORT="${DEV_DB_PORT}"
  export MY_BILL_DB_NAME="${DEV_DB_NAME}"
  export MY_BILL_DB_MIGRATION_USER="${DEV_DB_MIGRATION_USER}"
  export MY_BILL_DB_APP_USER="${DEV_DB_APP_USER}"
}
