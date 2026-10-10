#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_toolchain

cd "${PROJECT_ROOT}"
node --test scripts/lib/dev-environment.test.mjs
npm run check:deployment
npm --prefix web run check
./mvnw -B verify
bash scripts/test-database.sh
