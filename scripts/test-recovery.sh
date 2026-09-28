#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 先构建最新维护工具，再复用隔离数据库生命周期；不读取生产连接配置。
bash "$PROJECT_ROOT/scripts/check-server.sh"
MY_BILL_DATABASE_TEST_SUITE=recovery bash "$PROJECT_ROOT/scripts/test-database.sh"
