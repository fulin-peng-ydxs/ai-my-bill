#!/usr/bin/env bash
set -euo pipefail
umask 077
# 在目标主机 root 执行，仅激活已由受控签发端签发的叶证书；失败恢复旧证书。
[[ $(id -u) == 0 && $# == 3 ]] || { echo 'usage: activate-certificate.sh <new-leaf-directory> <public-ca-file> <private-ip>' >&2; exit 2; }
source_dir=$1; ca_file=$2; server_ip=$3
openssl verify -CAfile "$ca_file" -verify_ip "$server_ip" "$source_dir/server.crt"
openssl x509 -in "$source_dir/server.crt" -checkend 2592000 -noout
cert_key=$(openssl x509 -in "$source_dir/server.crt" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)
private_key=$(openssl pkey -in "$source_dir/server.key" -pubout -outform DER | openssl dgst -sha256)
[[ "$cert_key" == "$private_key" ]]
exec 9>/etc/my-bill/tls-activation.lock
flock -n 9 || exit 1
backup=$(mktemp -d /etc/my-bill/.tls-previous.XXXXXX)
cp -p /etc/my-bill/tls/server.crt /etc/my-bill/tls/server.key "$backup/"
activated=false
cleanup() {
  result=$?
  if [[ "$activated" != true ]]; then
    cp -p "$backup/server.crt" "$backup/server.key" /etc/my-bill/tls/
    docker exec my-bill-proxy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || logger -p daemon.err -t my-bill-tls 'ROLLBACK_RELOAD_FAILED'
    logger -p daemon.err -t my-bill-tls 'ACTIVATION_FAILED: previous leaf files restored'
  fi
  rm -rf -- "$backup"
  exit "$result"
}
trap cleanup EXIT
install -m 0600 -o 10001 -g 10001 "$source_dir/server.key" /etc/my-bill/tls/server.key.next
install -m 0644 -o 10001 -g 10001 "$source_dir/server.crt" /etc/my-bill/tls/server.crt.next
mv /etc/my-bill/tls/server.key.next /etc/my-bill/tls/server.key
mv /etc/my-bill/tls/server.crt.next /etc/my-bill/tls/server.crt
docker exec my-bill-proxy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
# 端口从非密钥配置读取，不 source 任意 env 内容。
port=$(sed -n 's/^MY_BILL_HTTPS_PORT=//p' /etc/my-bill/production.env)
port=${port:-18443}
[[ "$port" =~ ^[0-9]+$ ]]
curl --fail --silent --show-error --max-time 15 --cacert "$ca_file" "https://$server_ip:$port/api/v1/health" >/dev/null
activated=true
logger -t my-bill-tls 'SUCCEEDED: renewed leaf loaded and HTTPS verified'
