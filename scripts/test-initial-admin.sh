#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
source scripts/toolchain.sh
resolve_toolchain
check_dir=$(mktemp -d /tmp/my-bill-bootstrap.XXXXXX)
trap 'pg_ctl -D "$check_dir/db" -m fast stop >/dev/null 2>&1 || true; rm -rf "$check_dir"' EXIT
initdb -D "$check_dir/db" -U bootstrap_test --auth=trust --encoding=UTF8 --locale=C >/dev/null
check_port=$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
pg_ctl -D "$check_dir/db" -l "$check_dir/pg.log" -o "-h 127.0.0.1 -p $check_port" start >/dev/null
createdb -h 127.0.0.1 -p "$check_port" -U bootstrap_test bootstrap_test
MY_BILL_ROLE_MIGRATION_PASSWORD=migration_test MY_BILL_ROLE_APP_PASSWORD=app_test psql -h 127.0.0.1 -p "$check_port" -U bootstrap_test -d bootstrap_test -v ON_ERROR_STOP=1 -f deploy/postgres/001_roles.sql >/dev/null
printf '%s' 'R7sT9aB2cD4eF6gH8jK3' > "$check_dir/password"
printf '%s' 'bootstrap-test-only-pepper-1234567890' > "$check_dir/pepper"
export SPRING_DATASOURCE_URL="jdbc:postgresql://127.0.0.1:$check_port/bootstrap_test"
export SPRING_DATASOURCE_USERNAME=my_bill_app SPRING_DATASOURCE_PASSWORD=app_test
export MY_BILL_DB_MIGRATION_USER=my_bill_migration MY_BILL_DB_MIGRATION_PASSWORD=migration_test
export SPRING_FLYWAY_ENABLED=true
export MY_BILL_AUTH_RATE_LIMIT_PEPPER_FILE="$check_dir/pepper"
export MY_BILL_BOOTSTRAP_USERNAME=admin MY_BILL_BOOTSTRAP_PASSWORD_FILE="$check_dir/password"
java -jar server/target/my-bill-server-0.1.0-SNAPSHOT.jar --bootstrap-admin --server.address=127.0.0.1 --server.port=0 > "$check_dir/positive.log" 2>&1
result=$(psql -h 127.0.0.1 -p "$check_port" -U bootstrap_test -d bootstrap_test -Atc "select count(*) from app_user where role='ADMIN' and tenant_id is null and temporary_password_expires_at>now() and password_digest like '\$2a\$%'")
[[ "$result" == 1 ]]
if java -jar server/target/my-bill-server-0.1.0-SNAPSHOT.jar --bootstrap-admin --server.address=127.0.0.1 --server.port=0 > "$check_dir/repeat.log" 2>&1; then
 echo 'FAIL: repeated bootstrap accepted';exit 1
fi
[[ $(psql -h 127.0.0.1 -p "$check_port" -U bootstrap_test -d bootstrap_test -Atc "select count(*) from admin_audit_log where action='BOOTSTRAP_ADMIN'") == 1 ]]
echo 'PASS: isolated PostgreSQL initial admin, hashed temporary password, audit, repeat refusal'
