#!/usr/bin/env bash
set -euo pipefail

if [[ ! -t 0 ]]; then
  exec script -eq /dev/null bash "$0" "$@"
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_node

exec node "${PROJECT_ROOT}/scripts/check-ios.mjs" "$@"
