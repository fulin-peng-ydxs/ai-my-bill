#!/usr/bin/env bash
set -euo pipefail

if [[ ! -t 0 ]]; then
  exec script -eq /dev/null bash "$0" "$@"
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_node

if [[ "${1:-}" == --simulator ]]; then
  # 仅为本次检查选择完整 Xcode，不修改全局 xcode-select。
  if [[ -z "${DEVELOPER_DIR:-}" && "$(xcode-select -p)" == /Library/Developer/CommandLineTools && -d /Applications/Xcode.app ]]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  fi
  if ! xcrun --find simctl >/dev/null 2>&1; then
    printf '%s\n' '模拟器检查需要完整 Xcode；请先完成首次启动并安装 iOS runtime，非默认路径可设置 DEVELOPER_DIR。' >&2
    exit 1
  fi
fi

exec node "${PROJECT_ROOT}/scripts/check-ios.mjs" "$@"
