#!/usr/bin/env bash
set -euo pipefail

# 使用系统已安装的 PostgreSQL 16+ 可执行程序创建一次性隔离集群；不复用或修改业务数据库。
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_toolchain

for command_name in initdb postgres pg_isready createdb pg_ctl psql; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "数据库集成测试缺少 PostgreSQL 命令 ${command_name}。" >&2
    exit 1
  fi
done

postgres_major_version="$(postgres --version | sed -E 's/.* ([0-9]+)([.].*)?$/\1/')"
if [[ ! "${postgres_major_version}" =~ ^[0-9]+$ ]] || ((postgres_major_version < 16)); then
  echo "数据库集成测试需要 PostgreSQL 16 或更高版本。" >&2
  exit 1
fi

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/my-bill-db-test.XXXXXX")"
TEST_DATA="${TEST_ROOT}/postgres"
TEST_LOG="${TEST_ROOT}/postgres.log"
TEST_ADMIN="my_bill_test_admin"
TEST_DATABASE="my_bill_t2_test"
TEST_PORT=""

cleanup() {
  local exit_code=$?
  trap - EXIT HUP INT TERM
  if [[ -s "${TEST_DATA}/postmaster.pid" ]]; then
    pg_ctl -D "${TEST_DATA}" -m fast stop >/dev/null 2>&1 || true
  fi
  case "${TEST_ROOT}" in
    "${TMPDIR:-/tmp}"/my-bill-db-test.*) rm -rf "${TEST_ROOT}" ;;
    *) echo "拒绝清理非预期测试目录：${TEST_ROOT}" >&2 ;;
  esac
  exit "${exit_code}"
}
trap cleanup EXIT HUP INT TERM

for candidate_port in {55432..55462}; do
  if ! pg_isready -h 127.0.0.1 -p "${candidate_port}" >/dev/null 2>&1; then
    TEST_PORT="${candidate_port}"
    break
  fi
done
if [[ -z "${TEST_PORT}" ]]; then
  echo "数据库集成测试没有找到可用的本地端口。" >&2
  exit 1
fi

initdb -D "${TEST_DATA}" -U "${TEST_ADMIN}" --auth=trust --encoding=UTF8 --locale=C >/dev/null
pg_ctl -D "${TEST_DATA}" -l "${TEST_LOG}" -o "-h 127.0.0.1 -p ${TEST_PORT}" start >/dev/null
createdb -h 127.0.0.1 -p "${TEST_PORT}" -U "${TEST_ADMIN}" "${TEST_DATABASE}"

# 先模拟同名高权限角色漂移，再验证 provision 会幂等收敛为最小权限。
psql -h 127.0.0.1 -p "${TEST_PORT}" -U "${TEST_ADMIN}" -d "${TEST_DATABASE}" -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE my_bill_migration LOGIN SUPERUSER CREATEDB CREATEROLE INHERIT BYPASSRLS" \
  -c "CREATE ROLE my_bill_app LOGIN SUPERUSER CREATEDB CREATEROLE INHERIT BYPASSRLS" >/dev/null
MY_BILL_ROLE_MIGRATION_PASSWORD=migration_test MY_BILL_ROLE_APP_PASSWORD=app_test \
  psql -h 127.0.0.1 -p "${TEST_PORT}" -U "${TEST_ADMIN}" -d "${TEST_DATABASE}" \
  -v ON_ERROR_STOP=1 -f deploy/postgres/001_roles.sql >/dev/null
role_flags="$(psql -h 127.0.0.1 -p "${TEST_PORT}" -U "${TEST_ADMIN}" -d "${TEST_DATABASE}" -tAc \
  "SELECT string_agg(rolname || ':' || rolcanlogin::text || ':' || rolsuper::text || ':' || rolcreatedb::text || ':' || rolcreaterole::text || ':' || rolinherit::text || ':' || rolbypassrls::text, ',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('my_bill_app','my_bill_migration')")"
if [[ "${role_flags}" != "my_bill_app:true:false:false:false:false:false,my_bill_migration:true:false:false:false:false:false" ]]; then
  echo "数据库角色权限快照不符合最小权限：${role_flags}" >&2
  exit 1
fi

cd "${PROJECT_ROOT}"
./mvnw -B -pl server \
  -Dtest=PostgresSchemaIntegrationTest \
  -Dmybill.test.jdbc-url="jdbc:postgresql://127.0.0.1:${TEST_PORT}/${TEST_DATABASE}" \
  -Dmybill.test.admin-user="${TEST_ADMIN}" \
  -Dmybill.test.admin-password= \
  test

# schema undo 完成后移除 Flyway 历史表，再验证空环境角色回滚脚本可完整撤销授权和角色。
psql -h 127.0.0.1 -p "${TEST_PORT}" -U "${TEST_ADMIN}" -d "${TEST_DATABASE}" -v ON_ERROR_STOP=1 \
  -c "DROP TABLE flyway_schema_history" \
  -f deploy/postgres/rollback/001_drop_roles.sql >/dev/null
remaining_roles="$(psql -h 127.0.0.1 -p "${TEST_PORT}" -U "${TEST_ADMIN}" -d "${TEST_DATABASE}" -tAc \
  "SELECT count(*) FROM pg_roles WHERE rolname IN ('my_bill_app','my_bill_migration','my_bill_backup')")"
if [[ "${remaining_roles}" != "0" ]]; then
  echo "数据库角色回滚后仍存在目标角色。" >&2
  exit 1
fi
