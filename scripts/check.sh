#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_toolchain

cd "${PROJECT_ROOT}"
npm --prefix web run check
./mvnw -B verify
bash scripts/test-database.sh
