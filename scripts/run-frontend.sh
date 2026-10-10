#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_node
if [[ "${1:-}" == dev || "${1:-}" == preview ]]; then
  source "${PROJECT_ROOT}/scripts/lib/dev-environment.sh"
  load_dev_environment
fi
cd "${PROJECT_ROOT}"
if [[ "${1:-}" == dev ]]; then
  exec node scripts/lib/local-log-runner.mjs frontend npm --prefix web run "$@"
fi
exec npm --prefix web run "$@"
