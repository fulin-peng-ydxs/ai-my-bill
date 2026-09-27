#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MY_BILL_DATABASE_TEST_SUITE=e2e exec "${SCRIPT_DIR}/test-database.sh"
