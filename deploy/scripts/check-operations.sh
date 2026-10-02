#!/usr/bin/env bash
set -euo pipefail
# 只读巡检；告警写 journald，非零退出使 systemd 单元进入 failed。
[[ $(id -u) == 0 ]] || exit 1
result=0
alert() { logger -p daemon.err -t my-bill-monitor "$1"; echo "$1" >&2; result=1; }
python_command=python3
command -v "${python_command}" >/dev/null 2>&1 || python_command=python
for container in my-bill-db-1 my-bill-app-1 my-bill-proxy-1; do
  state=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)
  [[ "$state" == 'running healthy' || "$container" == my-bill-proxy-1 && "$state" == 'running ' ]] || alert "UNHEALTHY: $container"
done
openssl x509 -in /etc/my-bill/tls/server.crt -checkend 2592000 -noout >/dev/null 2>&1 || alert 'TLS_RENEWAL_REQUIRED: certificate expires within 30 days or cannot be read'
used=$(df -P /var/backups/my-bill | awk 'NR==2 {gsub(/%/,"",$5);print $5}')
[[ "$used" =~ ^[0-9]+$ && "$used" -lt 85 ]] || alert 'DISK_PRESSURE: backup filesystem is at least 85 percent full'
if ! "${python_command}" - <<'PY'
import os,time,datetime
p='/var/lib/my-bill/operations/backup.properties'
try:
    with open(p) as f: raw=f.read(4097)
    assert len(raw)<=4096
    d=dict(line.split('=',1) for line in raw.splitlines())
    # Producer writes UTC ISO timestamps. Historic offset timestamps are not used as the success clock.
    completed=d.get('latestCompletedAt','')
    if completed.endswith('Z'):
        import calendar
        stamp=calendar.timegm(time.strptime(completed,'%Y-%m-%dT%H:%M:%SZ'))
    else:
        raise ValueError('unsupported timestamp')
    now=time.time()
    attempt=calendar.timegm(time.strptime(d['attemptedAt'],'%Y-%m-%dT%H:%M:%SZ'))
    assert -300<=now-stamp<=26*3600 and stamp<=attempt<=now+300
    assert d['status']=='SUCCEEDED' or (d['status']=='RUNNING' and now-attempt<=3600)
except Exception:
    raise SystemExit(1)
PY
then alert 'BACKUP_ATTENTION: latest backup is failed, incomplete, stale or unreadable'; fi
if (( result == 0 )); then logger -t my-bill-monitor 'HEALTHY: containers, certificate, disk and backup'; fi
exit "$result"
