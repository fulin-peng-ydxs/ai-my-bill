#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_node
cd "${PROJECT_ROOT}"

MODE="${1:-common}"
if [[ $# -gt 1 || ! "${MODE}" =~ ^(common|ios-build|ios-smoke)$ ]]; then
  echo '用法：bash scripts/ios-app.sh [common|ios-build|ios-smoke]' >&2
  exit 2
fi

# 每次从源码生成，探针只供 NativeTests 的独立资源阶段使用。
npm --prefix app run native:sync
npm --prefix app run probe:bundle
npm --prefix app run test
node scripts/verify-ios-resources.mjs
node --test scripts/tests/ios-resources.test.mjs
if [[ "${MODE}" == common ]]; then exit 0; fi

if [[ -z "${DEVELOPER_DIR:-}" && "$(xcode-select -p)" == /Library/Developer/CommandLineTools && -d /Applications/Xcode.app ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
SDK_VERSION="$(xcrun --sdk iphoneos --show-sdk-version)"
if [[ ! "${SDK_VERSION}" =~ ^27\. ]]; then
  echo '原生验证需要 Xcode / iOS 27 SDK；可为本次命令设置 DEVELOPER_DIR，不修改全局选择。' >&2
  exit 1
fi

mkdir -p .local/ios/tmp/ai-agent .local/ios/SourcePackages
RUN_DIRECTORY="$(mktemp -d "${PROJECT_ROOT}/.local/ios/tmp/ai-agent/native-XXXXXX")"
SIMULATOR_ID=''
CRASH_TEST_PID=''
cleanup() {
  local status=$?
  if [[ -n "${CRASH_TEST_PID}" ]] && kill -0 "${CRASH_TEST_PID}" 2>/dev/null; then
    kill "${CRASH_TEST_PID}" 2>/dev/null || true
    wait "${CRASH_TEST_PID}" || true
  fi
  # 只操作本轮 create 的模拟器；绝不接管用户已经启动的设备。
  if [[ -n "${SIMULATOR_ID}" ]]; then
    local simulator_state
    simulator_state="$(xcrun simctl list devices --json | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(Object.values(JSON.parse(data).devices).flat().find(d => d.udid === process.argv[1])?.state ?? "Missing"))' "${SIMULATOR_ID}")"
    if [[ "${simulator_state}" != Shutdown && "${simulator_state}" != Missing ]]; then
      if ! xcrun simctl shutdown "${SIMULATOR_ID}"; then
        echo '本轮模拟器关闭失败，继续尝试删除。' >&2
        status=1
      fi
    fi
    if ! xcrun simctl delete "${SIMULATOR_ID}"; then
      echo "模拟器清理失败；本轮设备标识保留于 ${RUN_DIRECTORY}/simulator.udid" >&2
      status=1
    fi
  fi
  echo "本轮原生构建/测试证据：${RUN_DIRECTORY}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

XCODE_ARGUMENTS=(-project app/ios/App/App.xcodeproj -scheme App
  -derivedDataPath .local/ios/DerivedData -clonedSourcePackagesDirPath .local/ios/SourcePackages
  -disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO)
if [[ "${MODE}" == ios-build ]]; then
  # 这只证明真机架构 Release 编译；没有签名，不能声称可在真机安装。
  if ! xcodebuild build "${XCODE_ARGUMENTS[@]}" -configuration Release -destination 'generic/platform=iOS' > "${RUN_DIRECTORY}/build.log" 2>&1; then
    tail -60 "${RUN_DIRECTORY}/build.log" >&2
    exit 1
  fi
  node scripts/verify-ios-resources.mjs .local/ios/DerivedData/Build/Products/Release-iphoneos/App.app
else
  SIMULATOR_ID="$(xcrun simctl create '我的账单离线原生测试' com.apple.CoreSimulator.SimDeviceType.iPhone-14-Pro-Max com.apple.CoreSimulator.SimRuntime.iOS-27-0)"
  printf '%s\n' "${SIMULATOR_ID}" > "${RUN_DIRECTORY}/simulator.udid"
  xcrun simctl boot "${SIMULATOR_ID}"
  xcrun simctl bootstatus "${SIMULATOR_ID}" -b > "${RUN_DIRECTORY}/boot.log" 2>&1
  if ! xcodebuild test "${XCODE_ARGUMENTS[@]}" -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -skip-testing:NativeTests/NativeSqliteTests/testPrepareProcessInterruption -skip-testing:NativeTests/NativeSqliteTests/testRecoverProcessInterruption -resultBundlePath "${RUN_DIRECTORY}/native.xcresult" > "${RUN_DIRECTORY}/test.log" 2>&1; then
    tail -60 "${RUN_DIRECTORY}/test.log" >&2
    exit 1
  fi
  # 只对本轮模拟器的正式迁移路径分阶段中断；请求及信号只供 test bundle 消费。
  for CRASH_PHASE in snapshot-ready migration-recorded upgrade-committed; do
    APP_CONTAINER="$(xcrun simctl get_app_container "${SIMULATOR_ID}" com.mybill.offline data)"
    printf '%s' "${CRASH_PHASE}" > "${APP_CONTAINER}/Library/Caches/ledger-crash-request"
    xcodebuild test "${XCODE_ARGUMENTS[@]}" -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -only-testing:NativeTests/NativeSqliteTests/testPrepareProcessInterruption -resultBundlePath "${RUN_DIRECTORY}/interruption-${CRASH_PHASE}.xcresult" > "${RUN_DIRECTORY}/interruption-${CRASH_PHASE}.log" 2>&1 &
    CRASH_TEST_PID=$!
    TRANSACTION_READY=0
    for ((attempt=0; attempt<120; attempt++)); do
      APP_CONTAINER="$(xcrun simctl get_app_container "${SIMULATOR_ID}" com.mybill.offline data 2>/dev/null || true)"
      CRASH_MARKER="${APP_CONTAINER}/Library/Caches/ledger-crash-ready"
      if [[ -f "${CRASH_MARKER}" ]] && [[ "$(cat "${CRASH_MARKER}")" == "${CRASH_PHASE}" ]]; then TRANSACTION_READY=1; break; fi
      if ! kill -0 "${CRASH_TEST_PID}" 2>/dev/null; then break; fi
      sleep 1
    done
    if [[ "${TRANSACTION_READY}" != 1 ]]; then
      kill "${CRASH_TEST_PID}" 2>/dev/null || true
      wait "${CRASH_TEST_PID}" || true
      tail -40 "${RUN_DIRECTORY}/interruption-${CRASH_PHASE}.log" >&2
      echo '未观察到正式升级阶段信号，不执行中断、不判通过。' >&2
      exit 1
    fi
    xcrun simctl terminate "${SIMULATOR_ID}" com.mybill.offline
    CRASH_STATUS=0
    wait "${CRASH_TEST_PID}" || CRASH_STATUS=$?
    CRASH_TEST_PID=''
    if [[ "${CRASH_STATUS}" != 65 ]]; then
      echo "中断测试预期 xcodebuild 返回 65，实际 ${CRASH_STATUS}。" >&2
      exit 1
    fi
    printf '%s -> owned-app-terminated -> xcodebuild=%s\n' "${CRASH_PHASE}" "${CRASH_STATUS}" > "${RUN_DIRECTORY}/interruption-${CRASH_PHASE}-receipt.txt"
    if ! xcodebuild test "${XCODE_ARGUMENTS[@]}" -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -only-testing:NativeTests/NativeSqliteTests/testRecoverProcessInterruption -resultBundlePath "${RUN_DIRECTORY}/recovery-${CRASH_PHASE}.xcresult" > "${RUN_DIRECTORY}/recovery-${CRASH_PHASE}.log" 2>&1; then
      tail -40 "${RUN_DIRECTORY}/recovery-${CRASH_PHASE}.log" >&2
      exit 1
    fi
    sed -n '/LEDGER_PROCESS_INTERRUPTION_RECOVERED/p' "${RUN_DIRECTORY}/recovery-${CRASH_PHASE}.log"
  done
  # 输出固定探针结果，不打印数据库内容或真实设备信息。
  sed -n '/NATIVE_SQLITE_EVIDENCE/p; /LEDGER_LIFECYCLE_EVIDENCE/p; /Executed .* tests\{0,1\}, with/p; /\*\* TEST SUCCEEDED \*\*/p' "${RUN_DIRECTORY}/test.log"
fi
