#!/usr/bin/env bash
set -euo pipefail
umask 077
# 只消费本项目加密归档，在独立内部网络/临时数据库/临时导出目录演练；从不连接生产库。
[[ $# == 2 && $(id -u) == 0 ]] || { echo 'usage: verify-recovery-tool.sh <backup.cms> <verified-recovery-image>' >&2; exit 2; }
archive=$(readlink -f "$1"); image=$2
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
  -e POSTGRES_PASSWORD_FILE=/run/secrets/admin_password postgres:16.14-bookworm >/dev/null
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
  printf "CREATE ROLE my_bill_migration NOLOGIN;\nCREATE ROLE my_bill_app LOGIN PASSWORD '%s';\n" "$(cat "$work/app-password")"
} | docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
docker exec "$name" createdb -U postgres -O my_bill_migration my_bill_restore_drill
docker exec -i "$name" pg_restore -U postgres -d my_bill_restore_drill --exit-on-error < "$work/database.dump"
snapshot() {
  docker exec "$name" psql -U postgres -d my_bill_restore_drill -tAc \
    "SELECT count(*) || '|' || coalesce(sum(paid_amount),0)::text FROM ledger_entry"
}
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
    -e MY_BILL_AUTH_RATE_LIMIT_PEPPER_FILE=/run/secrets/auth_rate_limit_pepper \
    -e MY_BILL_RECOVERY_ACTION="$1" \
    -e MY_BILL_RECOVERY_AUDIT_FILE=/recovery/audit.jsonl \
    -e MY_BILL_RECOVERY_EXPECTED_DB_FINGERPRINT="$fingerprint" \
    -v "$work/app-password:/run/secrets/app_db_password:ro" \
    -v "$work/pepper:/run/secrets/auth_rate_limit_pepper:ro" \
    -v "$work/audit:/recovery:$2" -v "$work/exports:/var/lib/my-bill/exports" \
    "$image" --recovery-tool > "$work/tool-$1.log" 2>&1 || { tail -40 "$work/tool-$1.log" >&2; return 1; }
}
run_tool preserve rw
run_tool replay ro
run_tool replay ro
after=$(snapshot)
[[ "$before" == "$after" ]] || { echo '账目发生变化，需按注销重放结果人工对账，本脚本不宣称验收通过。' >&2; exit 1; }
echo "PASS: isolated encrypted database/export restore, audit preservation and repeat replay; elapsed=$(( $(date +%s)-started ))s"
if [[ "${before%%|*}" == 0 ]]; then echo 'LIMIT: backup has no ledger rows; this is tool/initial-database verification, not representative business RTO.'; fi
