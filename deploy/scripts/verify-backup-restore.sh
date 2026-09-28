#!/usr/bin/env bash
set -euo pipefail
umask 077
# 只恢复到无网络、无宿主端口的临时容器；不接受业务数据库连接参数。
[[ $# == 1 && $(id -u) == 0 ]] || exit 2
archive=$(readlink -f "$1")
[[ "$archive" =~ ^/var/backups/my-bill/(daily|weekly)/[0-9W-]+\.cms$ ]] || exit 2
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "${archive%.cms}.sha256")")
name="my-bill-restore-check-$$"
owned=false
cleanup() {
  result=$?
  if [[ "$owned" == true ]]; then docker rm -f "$name" >/dev/null; fi
  exit "$result"
}
trap cleanup EXIT
docker run -d --name "$name" --network none --memory 768m --cpus 1 --pids-limit 200 \
  --security-opt no-new-privileges:true --tmpfs /var/lib/postgresql/data:size=2g \
  -e POSTGRES_HOST_AUTH_METHOD=trust my-bill-postgres:16.14-bookworm >/dev/null
owned=true
ready=false
for attempt in {1..60}; do
  if docker logs "$name" 2>&1 | grep -q "PostgreSQL init process complete" &&
     docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]]
# 临时恢复实例中只建无登录角色供还原 RLS 策略引用，不复制任何生产凭据。
docker exec "$name" createuser -U postgres --no-login my_bill_app
docker exec "$name" createuser -U postgres --no-login my_bill_migration
docker exec "$name" createdb -U postgres my_bill_restore
openssl cms -decrypt -binary -inform DER -in "$archive" \
  -recip /etc/my-bill/backup-encryption.crt -inkey /etc/my-bill/backup-encryption.key |
  tar -xzOf - database.dump |
  docker exec -i "$name" pg_restore -U postgres -d my_bill_restore --no-owner --no-privileges --exit-on-error
# 全库重新导出可验证对象与数据均可读；不会暴露明细。
docker exec "$name" pg_dump -U postgres -d my_bill_restore -Fc > /dev/null
echo 'PASS: encrypted archive restored and re-exported in an isolated disposable container.'
