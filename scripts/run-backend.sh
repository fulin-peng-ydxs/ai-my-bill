#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
if [[ "${1:-}" != --logged-child ]]; then
  source "${PROJECT_ROOT}/scripts/lib/dev-environment.sh"
  load_dev_environment
  cd "${PROJECT_ROOT}"
  umask 077
  local_log_root="${MY_BILL_LOCAL_LOG_ROOT:-${PROJECT_ROOT}/.local/logs}"
  [[ "${local_log_root}" == /* ]] || local_log_root="${PROJECT_ROOT}/${local_log_root}"
  mkdir -p "${local_log_root}/backend"
  export SPRING_PROFILES_INCLUDE="${SPRING_PROFILES_INCLUDE:+${SPRING_PROFILES_INCLUDE},}local-logging"
  export LOGGING_FILE_NAME="${local_log_root}/backend/application.log"
  exec node scripts/lib/local-log-runner.mjs backend bash "$0" --logged-child "$@"
fi
shift
resolve_java
cd "${PROJECT_ROOT}"
exec ./mvnw -q -pl server spring-boot:run "$@"
