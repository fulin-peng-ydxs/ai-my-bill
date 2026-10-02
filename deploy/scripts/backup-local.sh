#!/usr/bin/env bash
set -euo pipefail
umask 077
export TZ=Asia/Shanghai
# 仅 root 调度；明文暂存目录 0700，归档加密后删除。只保留本项目服务器副本。
[[ $(id -u) == 0 ]] || exit 1
python_command=python3
command -v "${python_command}" >/dev/null 2>&1 || python_command=python
command -v "${python_command}" >/dev/null 2>&1 || { echo 'Python command is required for backup rotation.' >&2; exit 1; }
backup_root=/var/backups/my-bill
mkdir -p "$backup_root/daily" "$backup_root/weekly"
exec 9>"$backup_root/backup.lock"
flock -n 9 || exit 0
status_root=/var/lib/my-bill/operations
install -d -m 0755 -o root -g root "$status_root"
# 状态目录仅 root 可写，应用只读挂载；不得放入备份正文或密钥。
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
latest_completed=''
if [[ -f "$backup_root/last-success" ]]; then
  latest_completed=$(awk '$1 == "SUCCEEDED" {print $2}' "$backup_root/last-success")
  # last-success 使用宿主偏移格式；状态协议统一 UTC，失败/RUNNING 也必须可被 Java 解析。
  if [[ -n "$latest_completed" ]]; then
    latest_completed=$(date -u -d "$latest_completed" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)
  fi
fi
publish_status() {
  local state="$1" temporary
  temporary=$(mktemp "$status_root/.backup.XXXXXX")
  printf 'status=%s\nattemptedAt=%s\nlatestCompletedAt=%s\n' "$state" "$started_at" "$latest_completed" > "$temporary"
  chmod 0644 "$temporary"
  mv -f "$temporary" "$status_root/backup.properties"
}
work_dir=""
cleanup() {
  result=$?
  if [[ -n "$work_dir" ]]; then rm -rf -- "$work_dir"; fi
  if (( result != 0 )); then
    publish_status FAILED || true
    logger -p daemon.err -t my-bill-backup 'FAILED: backup or verification failed'
  fi
  exit "$result"
}
trap cleanup EXIT
publish_status RUNNING
work_dir=$(mktemp -d "$backup_root/.pending.XXXXXX")
stamp=$(date +%F)
# 数据库管理员仅在数据库容器内经本地 socket 使用；应用不可见其凭据。
docker exec my-bill-db-1 pg_dump -U my_bill_admin -d my_bill -Fc > "$work_dir/database.dump"
docker exec -i my-bill-db-1 pg_restore --list < "$work_dir/database.dump" > /dev/null
mkdir "$work_dir/exports"
docker cp my-bill-app-1:/var/lib/my-bill/exports/. "$work_dir/exports/"
printf 'created_at=%s\n' "$(date -Is)" > "$work_dir/manifest"
docker inspect --format '{{.Name}} {{.Image}}' my-bill-db-1 my-bill-app-1 my-bill-proxy-1 >> "$work_dir/manifest"
tar -C "$work_dir" -czf - database.dump exports manifest |
  openssl cms -encrypt -binary -stream -outform DER -aes256 \
    -out "$work_dir/archive.cms" /etc/my-bill/backup-encryption.crt
# 完整解密并检查 gzip/tar，验证私钥匹配和归档未截断；不将明文写出目录。
openssl cms -decrypt -binary -inform DER -in "$work_dir/archive.cms" \
  -recip /etc/my-bill/backup-encryption.crt -inkey /etc/my-bill/backup-encryption.key |
  tar -tzf - > /dev/null
mv "$work_dir/archive.cms" "$backup_root/daily/$stamp.cms"
(cd "$backup_root/daily" && sha256sum "$stamp.cms" > "$stamp.sha256")
# 每个 ISO 周保留最新成功副本；硬链接避免日/周重复占用空间。
week=$(date +%G-W%V)
ln -f "$backup_root/daily/$stamp.cms" "$backup_root/weekly/$week.cms"
(cd "$backup_root/weekly" && sha256sum "$week.cms" > "$week.sha256")
"${python_command}" - "$backup_root" <<'PY'
import os,re,sys,datetime
root=sys.argv[1]
today=datetime.date.today()
cutoffs={"daily":(today-datetime.timedelta(days=6)).isoformat(),
         "weekly":(today-datetime.timedelta(days=today.weekday()+21)).strftime("%G-W%V")}
for part,keep,pattern in [('daily',7,r'^\d{4}-\d{2}-\d{2}\.cms$'),('weekly',4,r'^\d{4}-W\d{2}\.cms$')]:
    directory=os.path.join(root,part)
    names=sorted(n for n in os.listdir(directory) if re.match(pattern,n))
    expired=set(names[:-keep])
    expired.update(n for n in names if n[:-4] < cutoffs[part])
    for name in sorted(expired):
        os.unlink(os.path.join(directory,name))
        checksum=os.path.join(directory,name[:-4]+'.sha256')
        if os.path.exists(checksum):os.unlink(checksum)
PY
latest_completed=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# 结束时间同时作为最新尝试时间，避免长备份被判为未来状态。
started_at=$latest_completed
publish_status SUCCEEDED
printf 'SUCCEEDED %s\n' "$(date -Is)" > "$backup_root/last-success"
logger -t my-bill-backup 'SUCCEEDED: encrypted local backup verified'
echo 'Encrypted local backup verified.'
