#!/usr/bin/env bash
set -euo pipefail
umask 077
# 只消费本项目加密归档，在独立内部网络/临时数据库/临时导出目录演练；从不连接生产库。
[[ ( $# == 2 || $# == 3 && "$3" == --synthetic ) && $(id -u) == 0 ]] || { echo 'usage: verify-recovery-tool.sh <backup.cms> <verified-recovery-image> [--synthetic]' >&2; exit 2; }
archive=$(readlink -f "$1"); image=$2
synthetic=${3:-}
project_root=$(cd "$(dirname "$0")/../.." && pwd)
[[ "$archive" =~ ^/var/backups/my-bill/(daily|weekly)/[0-9W-]+\.cms$ ]] || exit 2
[[ "$image" =~ ^my-bill-recovery:[a-f0-9]{7,40}$ ]] || exit 2
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "${archive%.cms}.sha256")")
started=$(date +%s)
work=$(mktemp -d /var/backups/my-bill/.recovery-drill.XXXXXX)
name="my-bill-recovery-drill-$$"; network="$name-net"
network_owned=false; db_owned=false
cleanup() {
  result=$?
  if [[ -s "$work/tool.cid" ]]; then docker rm -f "$(cat "$work/tool.cid")" >/dev/null 2>&1 || true; fi
  if [[ "$db_owned" == true ]]; then docker rm -f "$name" >/dev/null || result=1; fi
  if [[ "$network_owned" == true ]]; then docker network rm "$network" >/dev/null || result=1; fi
  rm -rf -- "$work" || result=1
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
openssl cms -decrypt -binary -inform DER -in "$archive" \
  -recip /etc/my-bill/backup-encryption.crt -inkey /etc/my-bill/backup-encryption.key |
  tar -xzf - --no-same-owner -C "$work" database.dump exports manifest
openssl rand -hex 32 > "$work/admin-password"
openssl rand -hex 32 > "$work/app-password"
openssl rand -hex 32 > "$work/pepper"
mkdir "$work/audit"
chown -R 10001:10001 "$work/exports" "$work/audit" "$work/app-password" "$work/pepper"
docker network create --internal "$network" >/dev/null
network_owned=true
docker run -d --name "$name" --network "$network" --network-alias recovery-db \
  --memory 768m --cpus 1 --pids-limit 200 --security-opt no-new-privileges:true \
  --tmpfs /var/lib/postgresql/data:size=2g \
  -v "$work/admin-password:/run/secrets/admin_password:ro" \
  -e POSTGRES_PASSWORD_FILE=/run/secrets/admin_password my-bill-postgres:16.14-bookworm >/dev/null
db_owned=true
ready=false
for attempt in {1..60}; do
  if docker logs "$name" 2>&1 | grep -q 'PostgreSQL init process complete' &&
     docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]]
# 隔离角色名与归档一致以恢复原所有权/授权；密码为本次随机值，不读取生产 secret。
{
  printf "CREATE ROLE my_bill_migration NOLOGIN NOINHERIT;\nCREATE ROLE my_bill_app LOGIN NOINHERIT PASSWORD '%s';\n" "$(cat "$work/app-password")"
} | docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
docker exec "$name" createdb -U postgres -O my_bill_migration my_bill_restore_drill
docker exec -i "$name" pg_restore -U postgres -d my_bill_restore_drill --exit-on-error < "$work/database.dump"
snapshot() {
  docker exec "$name" psql -U postgres -d my_bill_restore_drill -tAc \
    "SELECT count(*) || '|' || coalesce(sum(paid_amount),0)::text FROM ledger_entry"
}
if [[ "$synthetic" == --synthetic ]]; then
  { echo "SET my_bill.synthetic_drill='confirmed';"; cat "$project_root/server/src/test/resources/recovery/recovery-business-fixture.sql"; } |
    docker exec -i "$name" psql -U postgres -d my_bill_restore_drill -v ON_ERROR_STOP=1 >/dev/null
  # 文件路径来自本脚本生成的固定合成 UUID，禁止使用归档内任意绝对路径写宿主。
  for i in 1 2 3; do
    tenant=$(printf 'recovery-tenant-%s' "$i" | md5sum | awk '{print $1}' | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/')
    export_id=$(printf 'recovery-export-%s' "$i" | md5sum | awk '{print $1}' | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/')
    mkdir -p "$work/exports/$tenant"
    printf 'tenant,amount\n%s,246800.00\n' "$i" > "$work/exports/$tenant/$export_id.csv"
  done
  chown -R 10001:10001 "$work/exports"
  docker exec "$name" pg_dump -U postgres -d my_bill_restore_drill -Fc > "$work/synthetic.dump"
  tar -C "$work" -czf "$work/synthetic-exports.tgz" exports
  (cd "$work/exports" && find . -type f -exec sha256sum {} \; | sort) > "$work/exports.sha256"
fi
before=$(snapshot)
# 从应用实际使用的 TCP 地址取得指纹；不通过宿主端口访问临时库。
docker cp "$work/app-password" "$name:/tmp/drill-app-password" >/dev/null
fingerprint=$(docker exec "$name" sh -c 'export PGPASSWORD=$(cat /tmp/drill-app-password); exec psql -h recovery-db -U my_bill_app -d my_bill_restore_drill -tAc "SELECT current_database() || '\''|'\'' || inet_server_addr()::text || '\''|'\'' || inet_server_port()::text || '\''|'\'' || pg_postmaster_start_time()::text"')

run_tool() {
  rm -f "$work/tool.cid"
  timeout 180 docker run --rm --cidfile "$work/tool.cid" --network "$network" --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true \
    --memory 768m --cpus 1 --pids-limit 256 \
    -e JAVA_OPTS=-Xmx384m \
    -e MY_BILL_APP_DB_URL=jdbc:postgresql://recovery-db:5432/my_bill_restore_drill \
    -e MY_BILL_APP_DB_USERNAME=my_bill_app \
    -e MY_BILL_EXPORT_DIRECTORY=/var/lib/my-bill/exports \
    -e MY_BILL_AUTH_RATE_LIMIT_PEPPER_FILE=/run/secrets/auth_rate_limit_pepper \
    -e MY_BILL_RECOVERY_ACTION="$1" \
    -e MY_BILL_RECOVERY_AUDIT_FILE=/recovery/audit.jsonl \
    -e MY_BILL_RECOVERY_EXPECTED_DB_FINGERPRINT="$fingerprint" \
    -v "$work/app-password:/run/secrets/app_db_password:ro" \
    -v "$work/pepper:/run/secrets/auth_rate_limit_pepper:ro" \
    -v "$work/audit:/recovery:$2" -v "$work/exports:/var/lib/my-bill/exports" \
    "$image" --recovery-tool > "$work/tool-$1.log" 2>&1 || { tail -90 "$work/tool-$1.log" >&2; return 1; }
}
if [[ "$synthetic" == --synthetic ]]; then
  # 模拟备份之后完成的注销事实；审计不进入旧快照，必须独立保全后导入。
  docker exec "$name" psql -U postgres -d my_bill_restore_drill -v ON_ERROR_STOP=1 -c "INSERT INTO account_deletion_audit(id,actor_type,subject_digest,status,requested_at,executed_at,expires_at,result_summary) VALUES(md5('recovery-audit')::uuid,'SELF',encode(sha256(convert_to('my-bill/account-deletion/v1/' || md5('recovery-user-3')::uuid::text,'UTF8')),'hex'),'SUCCEEDED',now(),now(),now()+interval '180 days','synthetic deletion')" >/dev/null
fi
run_tool preserve rw
if [[ "$synthetic" == --synthetic ]]; then
  # 仅销毁本脚本临时容器内的副本，绝不接受外部数据库连接参数。
  docker exec "$name" dropdb -U postgres my_bill_restore_drill
  docker exec "$name" createdb -U postgres -O my_bill_migration my_bill_restore_drill
  docker exec -i "$name" pg_restore -U postgres -d my_bill_restore_drill --exit-on-error < "$work/synthetic.dump"
  rm -rf -- "$work/exports"
  tar -C "$work" -xzf "$work/synthetic-exports.tgz"
  (cd "$work/exports" && sha256sum -c "$work/exports.sha256") >/dev/null
  [[ "$(snapshot)" == "$before" ]]
  # 两个存续租户的 app 角色读取各为 10000，不能读取另一租户的数据。
  docker exec -i "$name" psql -U postgres -d my_bill_restore_drill -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
SET ROLE my_bill_app;
SELECT set_config('app.tenant_id',md5('recovery-tenant-1')::uuid::text,false);
DO $$ BEGIN
 IF (SELECT count(*) FROM ledger_entry) <> 10000 OR EXISTS(SELECT 1 FROM ledger_entry WHERE tenant_id=md5('recovery-tenant-2')::uuid) THEN RAISE EXCEPTION 'RLS tenant1 failure'; END IF;
END $$;
SELECT set_config('app.tenant_id',md5('recovery-tenant-2')::uuid::text,false);
DO $$ BEGIN IF (SELECT count(*) FROM ledger_entry) <> 10000 THEN RAISE EXCEPTION 'RLS tenant2 failure'; END IF; END $$;
SQL
fi
run_tool replay ro
run_tool replay ro
after=$(snapshot)
if [[ "$synthetic" == --synthetic ]]; then
  [[ "$after" == '20000|493600.00' ]]
  [[ $(find "$work/exports" -name '*.csv' -type f | wc -l) == 2 ]]
  # 重放后存续导出字节未变，已注销导出不再存在。
  # CentOS 7 的 coreutils 没有 --ignore-missing；仅选取仍存在的受控样本并逐项校验。
  while IFS= read -r line; do
    relative=${line#*  }
    if [[ -f "$work/exports/$relative" ]]; then printf '%s\n' "$line"; fi
  done < "$work/exports.sha256" > "$work/remaining-exports.sha256"
  [[ $(wc -l < "$work/remaining-exports.sha256") == 2 ]]
  (cd "$work/exports" && sha256sum -c "$work/remaining-exports.sha256") >/dev/null
  deleted=$(docker exec "$name" psql -U postgres -d my_bill_restore_drill -tAc "SELECT count(*) FROM app_user WHERE id=md5('recovery-user-3')::uuid")
  [[ "$deleted" == 0 ]]
  before=$after
  echo 'PASS: 30000-row snapshot restored; deletion after snapshot replayed; 20000 surviving rows, exact amounts, export hashes and two-tenant RLS verified.'
fi
[[ "$before" == "$after" ]] || { echo '账目发生变化，需按注销重放结果人工对账，本脚本不宣称验收通过。' >&2; exit 1; }
echo "PASS: isolated encrypted database/export restore, audit preservation and repeat replay; elapsed=$(( $(date +%s)-started ))s"
if [[ "${before%%|*}" == 0 ]]; then echo 'LIMIT: backup has no ledger rows; this is tool/initial-database verification, not representative business RTO.'; fi
