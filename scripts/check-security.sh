#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_toolchain

cd "${PROJECT_ROOT}"

secret_pattern='-----BEGIN ''([A-Z ]+ )?''PRIVATE KEY-----'
secret_pattern+='|AKIA''[0-9A-Z]{16}'
secret_pattern+='|gh[pousr]_''[A-Za-z0-9]{36,255}'
secret_pattern+='|github_pat_''[A-Za-z0-9_]{82,255}'
secret_pattern+='|xox[baprs]-''[A-Za-z0-9-]{10,}'
secret_pattern+='|AIza''[0-9A-Za-z_-]{35}'
if secret_matches="$(git ls-files -co --exclude-standard -z \
  | xargs -0 grep -IlE -- "${secret_pattern}" 2>/dev/null)"; then
  echo "当前工作区中发现疑似高置信 secret：" >&2
  printf '%s\n' "${secret_matches}" >&2
  exit 1
fi

if git log -p --all -- . | grep -IE -- "${secret_pattern}" >/dev/null; then
  echo "Git 历史中发现疑似高置信 secret；为避免凭据进入日志，不输出匹配内容。" >&2
  exit 1
fi

sensitive_name_pattern='(^|/)(\.env|id_(rsa|dsa|ecdsa|ed25519))$|[.](jks|p12|pfx|key)$'
sensitive_files="$(git ls-files -co --exclude-standard | grep -E "${sensitive_name_pattern}" || true)"
if [[ -n "${sensitive_files}" ]]; then
  echo "当前工作区中发现不应提交的敏感文件：" >&2
  printf '%s\n' "${sensitive_files}" >&2
  exit 1
fi
historical_sensitive_files="$(git log --all --name-only --format= | grep -E "${sensitive_name_pattern}" | sort -u || true)"
if [[ -n "${historical_sensitive_files}" ]]; then
  echo "Git 历史中发现不应提交的敏感文件：" >&2
  printf '%s\n' "${historical_sensitive_files}" >&2
  exit 1
fi

security_cache="${PROJECT_ROOT}/.local/web/security"
mkdir -p "${security_cache}"
./mvnw -B -q -pl server dependency:list \
  -DincludeScope=test \
  -DoutputFile="${security_cache}/maven-dependencies.txt" \
  -DappendOutput=false
./mvnw -B -q -pl server dependency:resolve-plugins \
  -DoutputFile="${security_cache}/maven-plugin-dependencies.txt"
node scripts/check-osv.mjs \
  web/package-lock.json \
  "${security_cache}/maven-dependencies.txt" \
  "${security_cache}/maven-plugin-dependencies.txt" \
  server/pom.xml
