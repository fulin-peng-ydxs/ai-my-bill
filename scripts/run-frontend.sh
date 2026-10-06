#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_node
cd "${PROJECT_ROOT}"
if [[ "${1:-}" == dev ]]; then
  exec node scripts/lib/local-log-runner.mjs frontend npm --prefix web run "$@"
fi
exec npm --prefix web run "$@"
