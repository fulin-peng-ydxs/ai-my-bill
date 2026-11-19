#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_toolchain

cd "${PROJECT_ROOT}"

bash "${PROJECT_ROOT}/scripts/check-secrets.sh"

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
