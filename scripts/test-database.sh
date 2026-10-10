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
SERVER_PID=""
WEB_PID=""

cleanup() {
  local exit_code=$?
  trap - EXIT HUP INT TERM
  if [[ -n "${WEB_PID}" ]]; then
    kill "${WEB_PID}" >/dev/null 2>&1 || true
    wait "${WEB_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
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
if [[ "${MY_BILL_DATABASE_TEST_SUITE:-regression}" == "e2e" ]]; then
  database_fingerprint="$(psql -h 127.0.0.1 -p "${TEST_PORT}" -U "${TEST_ADMIN}" -d "${TEST_DATABASE}" -tAc \
    "SELECT current_database() || '|' || inet_server_addr()::text || '|' || inet_server_port()::text || '|' || pg_postmaster_start_time()::text")"
  if [[ -z "${database_fingerprint}" ]]; then
    echo "E2E 数据库指纹为空，拒绝写入 fixture。" >&2
    exit 1
  fi

  if MY_BILL_E2E_WRITE=1 MY_BILL_E2E_EXPECTED_DB_FINGERPRINT="invalid-${database_fingerprint}" \
    ./mvnw -B -pl server \
      -Dtest=E2eFixtureSeederTest \
      -Dmybill.e2e.enabled=true \
      -Dmybill.test.jdbc-url="jdbc:postgresql://127.0.0.1:${TEST_PORT}/${TEST_DATABASE}" \
      test >"${TEST_ROOT}/guard-negative.log" 2>&1; then
    echo "E2E 错误数据库指纹未被拒绝。" >&2
    exit 1
  fi
  schema_after_rejection="$(psql -h 127.0.0.1 -p "${TEST_PORT}" -U "${TEST_ADMIN}" -d "${TEST_DATABASE}" -tAc \
    "SELECT to_regclass('public.flyway_schema_history') IS NOT NULL")"
  if [[ "${schema_after_rejection}" != "f" ]]; then
    echo "E2E 门禁拒绝前已经产生 schema 写入。" >&2
    exit 1
  fi

  MY_BILL_E2E_WRITE=1 MY_BILL_E2E_EXPECTED_DB_FINGERPRINT="${database_fingerprint}" \
    ./mvnw -B -pl server \
      -Dtest=E2eFixtureSeederTest \
      -Dmybill.e2e.enabled=true \
      -Dmybill.test.jdbc-url="jdbc:postgresql://127.0.0.1:${TEST_PORT}/${TEST_DATABASE}" \
      test

  ./mvnw -B -pl server -DskipTests package
  MY_BILL_BUILD_ID=e2e npm --prefix web run build
  server_jar="$(find server/target -maxdepth 1 -type f -name '*.jar' ! -name '*.original' | head -1)"
  if [[ -z "${server_jar}" ]]; then
    echo "E2E 未找到可启动的服务端 jar。" >&2
    exit 1
  fi
  server_port="$(node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
  web_port="$(node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"

  MY_BILL_DB_HOST=127.0.0.1 MY_BILL_DB_PORT="${TEST_PORT}" MY_BILL_DB_NAME="${TEST_DATABASE}" \
    MY_BILL_DB_APP_USER=my_bill_app MY_BILL_DB_APP_PASSWORD=app_test \
    MY_BILL_DB_MIGRATION_USER=my_bill_migration MY_BILL_DB_MIGRATION_PASSWORD=migration_test \
    MY_BILL_SERVER_PORT="${server_port}" MY_BILL_AUTH_RATE_LIMIT_PEPPER=t28-e2e-rate-limit-pepper \
    MY_BILL_EXPORT_DIRECTORY="${TEST_ROOT}/exports" MY_BILL_JOB_POLL_DELAY_MS=60000 \
    java -jar "${server_jar}" >"${TEST_ROOT}/server.log" 2>&1 &
  SERVER_PID=$!
  # 隔离测试直接调用 Vite，避开开发入口对 .local/dev.env 的加载。
  MY_BILL_SERVER_PORT="${server_port}" node web/node_modules/vite/bin/vite.js preview web --host 127.0.0.1 --port "${web_port}" \
    >"${TEST_ROOT}/web.log" 2>&1 &
  WEB_PID=$!

  for attempt in {1..90}; do
    if curl --fail --silent "http://127.0.0.1:${server_port}/api/v1/health" >/dev/null \
      && curl --fail --silent "http://127.0.0.1:${web_port}/login" >/dev/null; then
      break
    fi
    if ((attempt == 90)); then
      echo "E2E 服务未在等待窗口内就绪。" >&2
      sed -n '1,240p' "${TEST_ROOT}/server.log" >&2
      sed -n '1,160p' "${TEST_ROOT}/web.log" >&2
      exit 1
    fi
    sleep 1
  done

  if ! MY_BILL_E2E_BASE_URL="http://127.0.0.1:${web_port}" npm --prefix web run test:e2e; then
    sed -n '1,240p' "${TEST_ROOT}/server.log" >&2
    sed -n '1,160p' "${TEST_ROOT}/web.log" >&2
    exit 1
  fi
  exit 0
fi

if [[ "${MY_BILL_DATABASE_TEST_SUITE:-regression}" == "performance" ]]; then
  ./mvnw -B -pl server \
    -Dtest=PerformanceBaselineIntegrationTest \
    -Dmybill.performance.enabled=true \
    -Dmybill.test.jdbc-url="jdbc:postgresql://127.0.0.1:${TEST_PORT}/${TEST_DATABASE}" \
    test
  exit 0
fi

# 先在真实 Spring Security + PostgreSQL 上验证认证、管理用户、字典治理、个人偏好和支出填报闭环；测试库属于本次一次性集群。
./mvnw -B -pl server \
  -Dtest=AuthHttpIntegrationTest,AdminUserHttpIntegrationTest,AccountDeletionHttpIntegrationTest,PersonalDictionaryHttpIntegrationTest,GovernanceHttpIntegrationTest,PreferenceHttpIntegrationTest,ExpenseHttpIntegrationTest,IncomeHttpIntegrationTest,DailyTemplateHttpIntegrationTest,LedgerQueryHttpIntegrationTest,ExpenseAdjustmentHttpIntegrationTest,LedgerLifecycleHttpIntegrationTest,ExportHttpIntegrationTest,ReportHttpIntegrationTest \
  -Dmybill.test.jdbc-url="jdbc:postgresql://127.0.0.1:${TEST_PORT}/${TEST_DATABASE}" \
  test

# 完整恢复演练复用本脚本的一次性集群与合成业务样本，不接受外部数据库地址。
if [[ "${MY_BILL_DATABASE_TEST_SUITE:-regression}" == "recovery" ]]; then
  recovery_started=$(date +%s)
  restore_database=my_bill_restore_drill
  snapshot_query="SELECT count(*) || '|' || coalesce(sum(paid_amount),0)::text FROM ledger_entry"
  before_restore=$(psql -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_ADMIN" -d "$TEST_DATABASE" -tAc "$snapshot_query")
  [[ "${before_restore%%|*}" -gt 0 ]] || { echo "恢复样本为空，拒绝宣称业务演练通过" >&2; exit 1; }
  pg_dump -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_ADMIN" -d "$TEST_DATABASE" -Fc -f "$TEST_ROOT/database.dump"
  printf '%s' 'isolated-recovery-pepper-with-at-least-32-characters' > "$TEST_ROOT/pepper"
  recovery_jar=$(find server/target -maxdepth 1 -name 'my-bill-server-*.jar' -print -quit)
  [[ -n "$recovery_jar" ]]
  run_recovery() {
    MY_BILL_DB_HOST=127.0.0.1 MY_BILL_DB_PORT="$TEST_PORT" MY_BILL_DB_NAME="$1" \
    MY_BILL_DB_APP_PASSWORD=app_test MY_BILL_AUTH_RATE_LIMIT_PEPPER_FILE="$TEST_ROOT/pepper" \
    MY_BILL_RECOVERY_ACTION="$2" MY_BILL_RECOVERY_AUDIT_FILE="$TEST_ROOT/deletion-audit.jsonl" \
    MY_BILL_RECOVERY_EXPECTED_DB_FINGERPRINT="${3:-}" MY_BILL_EXPORT_DIRECTORY="$TEST_ROOT/exports" \
      java -jar "$recovery_jar" --recovery-tool > "$TEST_ROOT/recovery-$2.log" 2>&1 || { tail -50 "$TEST_ROOT/recovery-$2.log"; return 1; }
  }
  run_recovery "$TEST_DATABASE" preserve
  createdb -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_ADMIN" -O my_bill_migration "$restore_database"
  pg_restore -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_ADMIN" -d "$restore_database" --exit-on-error "$TEST_ROOT/database.dump"
  after_restore=$(psql -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_ADMIN" -d "$restore_database" -tAc "$snapshot_query")
  [[ "$before_restore" == "$after_restore" ]]
  restore_fingerprint=$(psql -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_ADMIN" -d "$restore_database" -tAc \
    "SELECT current_database() || '|' || inet_server_addr()::text || '|' || inet_server_port()::text || '|' || pg_postmaster_start_time()::text")
  # 在恢复副本中重建旧快照仍含已注销主体的情景，原库与保全审计保持不变。
  restored_export="$TEST_ROOT/exports/19100000-0000-4000-8000-000000000001/19300000-0000-4000-8000-000000000001.csv"
  mkdir -p "$(dirname "$restored_export")"
  printf '%s' 'isolated restored export' > "$restored_export"
  psql -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_ADMIN" -d "$restore_database" -v ON_ERROR_STOP=1 -v export_file="$restored_export" <<'SQL' >/dev/null
-- 仅本脚本创建的一次性恢复库：模拟旧快照中的已注销身份与导出，退出即销毁整个集群。
INSERT INTO tenant(id) VALUES('19100000-0000-4000-8000-000000000001');
INSERT INTO app_user(id,tenant_id,username,password_digest,role)
VALUES('19200000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000001','restore-deleted-fixture','unusable-test-password','USER');
INSERT INTO export_job(tenant_id,id,user_id,filter_snapshot,status,file_location,expires_at)
VALUES('19100000-0000-4000-8000-000000000001','19300000-0000-4000-8000-000000000001','19200000-0000-4000-8000-000000000001','{}','SUCCEEDED',:'export_file',now()+interval '1 day');
SQL
  retained_users=$(psql -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_ADMIN" -d "$restore_database" -tAc "SELECT count(*) FROM app_user")
  run_recovery "$restore_database" replay "$restore_fingerprint"
  run_recovery "$restore_database" replay "$restore_fingerprint"
  [[ ! -e "$restored_export" ]]
  remaining_users=$(psql -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_ADMIN" -d "$restore_database" -tAc "SELECT count(*) FROM app_user")
  [[ "$remaining_users" -eq $((retained_users-1)) ]]
  after_replay=$(psql -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_ADMIN" -d "$restore_database" -tAc "$snapshot_query")
  [[ "$after_replay" == "$before_restore" ]]
  echo "PASS: isolated business database dump/restore, count and exact amount comparison, audit preservation and repeat replay; elapsed=$(( $(date +%s)-recovery_started ))s"
  exit 0
fi

# 认证集成测试已完成后重建隔离 schema，让 T2 空库迁移测试仍从真正的零版本开始。
psql -h 127.0.0.1 -p "${TEST_PORT}" -U "${TEST_ADMIN}" -d "${TEST_DATABASE}" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE" \
  -c "CREATE SCHEMA public AUTHORIZATION my_bill_migration" \
  -c "REVOKE CREATE ON SCHEMA public FROM PUBLIC" >/dev/null

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
