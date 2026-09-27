#!/usr/bin/env bash
set -euo pipefail

# 复用数据库回归的隔离集群和最小权限角色，只切换到代表性规模性能套件。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MY_BILL_DATABASE_TEST_SUITE=performance exec bash "${SCRIPT_DIR}/test-database.sh"
