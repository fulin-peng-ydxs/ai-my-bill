#!/bin/zsh
# 先登记再放行；仅使用系统 Shell 内建，避免每条原生命令先冷启动一个 Node。
set -eu
trace() {
  printf '{"stage":"%s","pid":%d,"uid":%d,"euid":%d,"bytes":%d}\n' "$1" "$$" "$UID" "$EUID" "$2" >&4
}
trace waiting 0
message=''
complete=false
while IFS= read -r -k 1 -u3 byte; do
  if [[ "$byte" = $'\n' ]]; then
    message+=$'\n'
    trace frame "${#message}"
    complete=true
    break
  fi
  message+="$byte"
  trace frame "${#message}"
  [[ ${#message} -le 16 ]] || exit 1
done
[[ "$complete" = true && "$message" = $'GO\n' ]] || exit 1
# 同一已到达帧不能夹带第二条消息；不等待父端 EOF。
if IFS= read -r -k 1 -t 0 -u3 extra; then exit 1; fi
trace starting "${#message}"
trace started "${#message}"
exec 3<&-
exec 4>&-
exec "$@"
