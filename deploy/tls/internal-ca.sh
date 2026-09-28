#!/usr/bin/env bash
set -euo pipefail
umask 077

# 仅在受控签发端执行；不自动安装根证书信任，不把 CA 私钥上传服务器。
usage() { echo '用法: internal-ca.sh init <CA目录> | issue <CA目录> <RFC1918-IP> <新输出目录>' >&2; exit 2; }
[[ $# -ge 2 ]] || usage
mode="$1"; ca_directory="$2"
case "$mode" in
  init)
    [[ $# == 2 ]] || usage
    [[ ! -e "$ca_directory" ]] || { echo 'CA 目录已存在，拒绝覆盖。' >&2; exit 1; }
    mkdir -p "$ca_directory"
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$ca_directory/ca.key"
    openssl req -new -x509 -sha256 -days 3650 -key "$ca_directory/ca.key" \
      -subj '/CN=My Bill Private Root CA' -out "$ca_directory/ca.crt" \
      -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
      -addext 'keyUsage=critical,keyCertSign,cRLSign' \
      -addext 'subjectKeyIdentifier=hash'
    openssl x509 -in "$ca_directory/ca.crt" -noout -fingerprint -sha256
    ;;
  issue)
    [[ $# == 4 ]] || usage
    server_ip="$3"; output_directory="$4"
    python3 - "$server_ip" <<'PY'
import ipaddress,sys
address=ipaddress.ip_address(sys.argv[1])
assert any(address in ipaddress.ip_network(n) for n in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16']), '只接受 RFC1918 内网 IPv4'
PY
    openssl x509 -in "$ca_directory/ca.crt" -checkend 8035200 -noout >/dev/null
    [[ ! -e "$output_directory" ]] || { echo '输出目录已存在，拒绝覆盖；续期使用新目录。' >&2; exit 1; }
    mkdir -p "$output_directory"
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$output_directory/server.key"
    openssl req -new -key "$output_directory/server.key" -subj '/CN=My Bill Intranet' -out "$output_directory/server.csr"
    cat > "$output_directory/extensions.cnf" <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=IP:$server_ip
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EXT
    # 随机序列号避免并发签发争抢共享 serial 文件；叶证书每 90 天轮换。
    serial="$(openssl rand -hex 16)"
    openssl x509 -req -in "$output_directory/server.csr" -CA "$ca_directory/ca.crt" \
      -CAkey "$ca_directory/ca.key" -set_serial "0x$serial" -days 90 -sha256 \
      -extfile "$output_directory/extensions.cnf" -out "$output_directory/server.crt"
    openssl verify -CAfile "$ca_directory/ca.crt" -verify_ip "$server_ip" "$output_directory/server.crt"
    rm "$output_directory/server.csr" "$output_directory/extensions.cnf"
    ;;
  *) usage ;;
esac
