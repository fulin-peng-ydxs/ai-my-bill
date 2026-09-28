#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_java

cd "${PROJECT_ROOT}"
exec ./mvnw -q -pl server spring-boot:run "$@"
