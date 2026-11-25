#!/usr/bin/env bash
set -euo pipefail
# 同一本地/CI 固定版本扫描；不读取忽略的本地数据，不启动旧端服务。
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
if [[ "${1:-}" == "--history" && "$#" == 1 ]]; then
  exec python3 scripts/lib/ios-security.py secrets-history
fi
exec python3 scripts/lib/ios-security.py secrets "$@"
