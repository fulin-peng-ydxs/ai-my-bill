#!/usr/bin/env bash
set -euo pipefail

# 调度器通过不可变标准输入执行时 cwd 已固定为仓库根；直接诊断本文件时仍按文件定位。
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
else
  PROJECT_ROOT="${PWD}"
fi
source "${PROJECT_ROOT}/scripts/toolchain.sh"
resolve_node
cd "${PROJECT_ROOT}"

MODE="${1:-common}"
if [[ $# -gt 1 || ! "${MODE}" =~ ^(common|ios-build|ios-smoke|ios-touch|ios-recovery)$ ]]; then
  echo '用法：bash scripts/ios-app.sh [common|ios-build|ios-smoke|ios-touch]' >&2
  exit 2
fi

# 内部脚本不能绕过调度器的局部证据和失败锁；在生成资源前拒绝直接执行。
if [[ -z "${MYBILL_FULL_ATTEMPT:-}" ]]; then
  echo '内部入口缺少调度许可；请使用根目录 ios-app.sh 命令。' >&2
  exit 2
fi
node scripts/lib/ios-verification.mjs permit "${MODE}" "${MYBILL_FULL_ATTEMPT}"

mkdir -p .local/ios/tmp/ai-agent .local/ios/SourcePackages
RUN_DIRECTORY="$(mktemp -d "${PROJECT_ROOT}/.local/ios/tmp/ai-agent/native-XXXXXX")"
SIMULATOR_ID=''
SIMULATOR_BORROWED=0
CRASH_TEST_PID=''
cleanup() {
  local status=$?
  if [[ -n "${CRASH_TEST_PID}" ]] && kill -0 "${CRASH_TEST_PID}" 2>/dev/null; then
    kill "${CRASH_TEST_PID}" 2>/dev/null || true
    wait "${CRASH_TEST_PID}" || true
  fi
  # 只操作本命令新建或再次校验的本轮会话设备；借用设备只关闭运行，不销毁。
  if [[ -n "${SIMULATOR_ID}" ]]; then
    local simulator_state
    simulator_state="$(xcrun simctl list devices --json | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(Object.values(JSON.parse(data).devices).flat().find(d => d.udid === process.argv[1])?.state ?? "Missing"))' "${SIMULATOR_ID}")"
    if [[ "${simulator_state}" != Shutdown && "${simulator_state}" != Missing ]]; then
      if ! xcrun simctl shutdown "${SIMULATOR_ID}"; then
        echo '本轮模拟器关闭失败，继续尝试删除。' >&2
        status=1
      fi
    fi
    if [[ "${SIMULATOR_BORROWED}" == 0 ]] && ! xcrun simctl delete "${SIMULATOR_ID}"; then
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

phase() {
  node scripts/lib/ios-verification.mjs phase "${MODE}" "${MYBILL_FULL_ATTEMPT}" "$@"
}
run_phase() {
  local stage="$1" coverage="$2" log="$3" report="$4"
  shift 4
  phase "${stage}" "${coverage}" "${log}" "${report}" || return
  if ! "$@" > "${log}" 2>&1; then tail -60 "${log}" >&2; return 1; fi
  cat "${log}"
}
# 构建、显式安装、测试分开计时；XCTest 的再次安装校验属于测试准备，不包含编译。
prepare_test() {
  local test_log="$1" argument next index
  shift
  TEST_ARGS=("$@")
  BUILD_ARGS=()
  TEST_SCHEME=App
  TEST_CONFIG=Debug
  TEST_DERIVED=.local/ios/DerivedData
  for ((index=0; index<${#TEST_ARGS[@]}; index++)); do
    argument="${TEST_ARGS[$index]}"
    next="${TEST_ARGS[$((index+1))]:-}"
    case "${argument}" in
      -scheme) TEST_SCHEME="${next}" ;;
      -configuration) TEST_CONFIG="${next}" ;;
      -derivedDataPath) TEST_DERIVED="${next}" ;;
      -resultBundlePath) index=$((index+1)); continue ;;
    esac
    BUILD_ARGS+=("${argument}")
  done
  phase build "native-build/${TEST_SCHEME}/${TEST_CONFIG}" "${test_log%.log}-build.log" || return
  if ! xcodebuild build-for-testing "${BUILD_ARGS[@]}" > "${test_log%.log}-build.log" 2>&1; then tail -60 "${test_log%.log}-build.log" >&2; return 1; fi
  phase install "native-install/${TEST_SCHEME}/${TEST_CONFIG}" "${test_log%.log}-install.log" || return
  xcrun simctl install "${SIMULATOR_ID}" "${TEST_DERIVED}/Build/Products/${TEST_CONFIG}-iphonesimulator/App.app" > "${test_log%.log}-install.log" 2>&1 || return
  if [[ "${TEST_SCHEME}" == DictionaryTouch ]]; then
    xcrun simctl install "${SIMULATOR_ID}" "${TEST_DERIVED}/Build/Products/${TEST_CONFIG}-iphonesimulator/DictionaryUITests-Runner.app" >> "${test_log%.log}-install.log" 2>&1 || return
  fi
}
positive_test() {
  local test_log="$1"
  shift
  prepare_test "${test_log}" "$@" || return
  phase test "${RECOVERY_COVERAGE:-native-startup/${TEST_SCHEME}/${TEST_CONFIG}}" "${test_log}" || return
  xcodebuild test-without-building -collect-test-diagnostics never "${TEST_ARGS[@]}" > "${test_log}" 2>&1
}

run_phase build check/app-build "${RUN_DIRECTORY}/app-build.log" '' npm --prefix app run native:sync
run_phase build check/probe-build "${RUN_DIRECTORY}/probe-build.log" '' npm --prefix app run probe:bundle
if [[ "${MODE}" != ios-recovery ]]; then
  COVERAGE_ARGS=(--coverage --maxWorkers=2 --coverage.reportsDirectory="${RUN_DIRECTORY}/coverage")
  run_phase check check/app-tests "${RUN_DIRECTORY}/app-tests.log" "${RUN_DIRECTORY}/app-tests.json" npm --prefix app test -- --bail=1 --reporter=json --outputFile="${RUN_DIRECTORY}/app-tests.json" "${COVERAGE_ARGS[@]}"
  run_phase check check/app-coverage "${RUN_DIRECTORY}/coverage.log" "${RUN_DIRECTORY}/coverage/coverage-proof.json" node scripts/ios-coverage.mjs "${RUN_DIRECTORY}/coverage"
  run_phase check check/script-tests "${RUN_DIRECTORY}/script-tests.log" '' node scripts/lib/ios-checks.mjs run-script-tests
fi
run_phase check check/resources/source "${RUN_DIRECTORY}/resources.log" '' node scripts/verify-ios-resources.mjs
if [[ "${MODE}" == common ]]; then exit 0; fi
if [[ -z "${DEVELOPER_DIR:-}" && "$(xcode-select -p)" == /Library/Developer/CommandLineTools && -d /Applications/Xcode.app ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
SDK_VERSION="$(xcrun --sdk iphoneos --show-sdk-version)"
if [[ ! "${SDK_VERSION}" =~ ^27\. ]]; then echo '需要 Xcode / iOS 27 SDK。' >&2; exit 1; fi

XCODE_COMMON_ARGUMENTS=(-project app/ios/App/App.xcodeproj
  -derivedDataPath .local/ios/DerivedData -clonedSourcePackagesDirPath .local/ios/SourcePackages
  -disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO)
XCODE_ARGUMENTS=("${XCODE_COMMON_ARGUMENTS[@]}" -scheme App)
if [[ "${MODE}" == ios-build ]]; then
  # 这只证明真机架构 Release 编译；没有签名，不能声称可在真机安装。
  phase build native-build/App/Release "${RUN_DIRECTORY}/build.log"
  if ! xcodebuild build "${XCODE_ARGUMENTS[@]}" -configuration Release -destination 'generic/platform=iOS' > "${RUN_DIRECTORY}/build.log" 2>&1; then
    tail -60 "${RUN_DIRECTORY}/build.log" >&2
    exit 1
  fi
  run_phase check check/resources/device "${RUN_DIRECTORY}/device-resources.log" '' node scripts/verify-ios-resources.mjs .local/ios/DerivedData/Build/Products/Release-iphoneos/App.app
else
  phase boot native-boot "${RUN_DIRECTORY}/boot.log"
  if [[ -n "${MYBILL_FULL_SESSION:-}" ]]; then
    # 借用只限本仓库明确打开的调试会话；独立校验后才允许结束/卸载其中的合成测试 App。
    SESSION_INFO="$(node --input-type=module - "${MYBILL_FULL_SESSION}" <<'JS'
import { readSession, assertDevice } from './scripts/lib/ios-debug.mjs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const session = readSession(path.resolve('.local/ios/tmp/ai-agent'), process.argv[2])
const device = assertDevice(session.context, JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', '--json'], { encoding: 'utf8' })))
if (!['Booted', 'Shutdown'].includes(device.state)) throw new Error('设备状态正在切换，未接管或重置 App。')
console.log(JSON.stringify({ id: device.udid, state: device.state, context: session.file }))
JS
)"
    SIMULATOR_ID="$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "${SESSION_INFO}")"
    SIMULATOR_BORROWED=1
    CONTEXT_FILE="$(node -e 'console.log(JSON.parse(process.argv[1]).context)' "${SESSION_INFO}")"
    SIMULATOR_STATE="$(node -e 'console.log(JSON.parse(process.argv[1]).state)' "${SESSION_INFO}")"
    xcrun simctl bootstatus "${SIMULATOR_ID}" -b > "${RUN_DIRECTORY}/boot.log" 2>&1
    INSTALLED="$(xcrun simctl listapps "${SIMULATOR_ID}" | plutil -convert json -o - - | node -e 'let s=""; process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log(Boolean(JSON.parse(s)["com.mybill.offline"])))')"
    # 与局部入口共用归属校验；完整流程明确冷重置，卸载成功后失效旧登记，不能留下误拦后续调试的回执。
    node --input-type=module - "${MYBILL_FULL_SESSION}" "${SIMULATOR_ID}" "${INSTALLED}" <<'JS'
import { execFileSync, spawnSync } from 'node:child_process'
import { readSession, APP_ID, hashPaths } from './scripts/lib/ios-debug.mjs'
import { inspectInstallation, forgetInstallation } from './scripts/lib/ios-cache.mjs'
import path from 'node:path'
const session = readSession(path.resolve('.local/ios/tmp/ai-agent'), process.argv[2])
if (session.context.simulatorId !== process.argv[3]) throw new Error('安装登记设备归属不符。')
const sim = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', timeout: 30_000 }).trim()
const installed = process.argv[4] === 'true'
const container = installed ? sim('get_app_container', session.context.simulatorId, APP_ID, 'data') : undefined
const hash = installed ? hashPaths(sim('get_app_container', session.context.simulatorId, APP_ID, 'app'), ['.']) : undefined
await inspectInstallation(session, container, hash, async (lease, mode) => {
  const stopped = spawnSync('xcrun', ['simctl', 'terminate', session.context.simulatorId, APP_ID], { encoding: 'utf8', timeout: 30_000 })
  if (stopped.error || stopped.status !== 0 && !(stopped.status === 3 && (stopped.stdout + stopped.stderr).includes('found nothing to terminate')))
    throw new Error('结束本轮 App 失败，拒绝重绑或卸载。')
  execFileSync('python3', ['-I', 'scripts/fixtures/ios-ui-baseline.py', mode, session.file, container, lease.appHash],
    { stdio: 'inherit', timeout: 30_000 })
}, true)
if (installed) sim('uninstall', session.context.simulatorId, APP_ID)
forgetInstallation(session)
JS
    echo "完整验收借用本轮设备 ${SIMULATOR_ID}；重置合成 App 数据，退出时关闭设备运行并保留会话。"
  else
    SIMULATOR_ID="$(xcrun simctl create '我的账单离线原生测试' com.apple.CoreSimulator.SimDeviceType.iPhone-14-Pro-Max com.apple.CoreSimulator.SimRuntime.iOS-27-0)"
    CONTEXT_FILE="${RUN_DIRECTORY}/test-context.json"
    node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({simulatorId: process.argv[2], runId: crypto.randomUUID(), appId: "com.mybill.offline"}), {mode: 0o600})' "${CONTEXT_FILE}" "${SIMULATOR_ID}"
    xcrun simctl bootstatus "${SIMULATOR_ID}" -b > "${RUN_DIRECTORY}/boot.log" 2>&1
  fi
  printf '%s\n' "${SIMULATOR_ID}" > "${RUN_DIRECTORY}/simulator.udid"
  # 测试 bundle 在注入探针或启动 UI 操作前校验本轮设备归属；生产 App 不读取清单。
  XCODE_COMMON_ARGUMENTS+=("MYBILL_TEST_CONTEXT_FILE=${CONTEXT_FILE}")
  XCODE_ARGUMENTS=("${XCODE_COMMON_ARGUMENTS[@]}" -scheme App)
  # 先完成首次运行时/正式账本初始化，再由 XCTest 重新启动宿主，分离环境准备和测试。
  # 这不是冷启动性能验收；readyWebView 的 20 秒和单用例 60 秒预算保持不变。
  prepare_test "${RUN_DIRECTORY}/prepare.log" "${XCODE_ARGUMENTS[@]}" -destination "platform=iOS Simulator,id=${SIMULATOR_ID}"
  phase initialize native-initialize/App/Debug "${RUN_DIRECTORY}/prepare-host.log"
  xcrun simctl launch "${SIMULATOR_ID}" com.mybill.offline > "${RUN_DIRECTORY}/prepare-launch.log"
  PREPARE_CONTAINER="$(xcrun simctl get_app_container "${SIMULATOR_ID}" com.mybill.offline data)"
  python3 scripts/fixtures/dictionary-touch.py wait-initialized "${PREPARE_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/unused-receipt.json" > "${RUN_DIRECTORY}/prepare-host.log" 2>&1
  xcrun simctl terminate "${SIMULATOR_ID}" com.mybill.offline
  if [[ "${MODE}" == ios-touch ]]; then
    # 正式生命周期先创建空账本；夹具仅写本轮模拟器、进程关闭后的文件，不启用 T6 保存。
    if ! positive_test "${RUN_DIRECTORY}/touch-initialize.log" "${XCODE_ARGUMENTS[@]}" -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -only-testing:NativeTests/NativeSqliteTests/testBundledEntryAndNativeSqliteBridge -resultBundlePath "${RUN_DIRECTORY}/touch-initialize.xcresult"; then
      tail -60 "${RUN_DIRECTORY}/touch-initialize.log" >&2
      exit 1
    fi
    stop_owned_app() {
      local stop_log="$1"
      local termination_status=0
      xcrun simctl terminate "${SIMULATOR_ID}" com.mybill.offline > "${stop_log}" 2>&1 || termination_status=$?
      # XCTest 可能已结束宿主；只接受明确的 ESRCH/无可终止进程，其他失败仍阻断回读。
      if [[ "${termination_status}" != 0 ]] && { [[ "${termination_status}" != 3 ]] || ! grep -Fq 'found nothing to terminate' "${stop_log}"; }; then
        cat "${stop_log}" >&2
        return "${termination_status}"
      fi
      # XCTest 安装校验/重启可能搬迁沙盒；每组回读和下一组夹具都使用停止后的实际路径。
      APP_CONTAINER="$(xcrun simctl get_app_container "${SIMULATOR_ID}" com.mybill.offline data)"
    }
    stop_owned_app "${RUN_DIRECTORY}/touch-stop.log"
    # 在本轮空模拟器上证明两个直接测试入口没有清单时会拒绝，且不会写入业务数据。
    assert_unowned_rejected() {
      local scheme="$1" configuration="$2" test_case="$3" label="$4"
      local rejection_status=0
      local unowned_arguments=() argument
      for argument in "${XCODE_COMMON_ARGUMENTS[@]}"; do
        if [[ "${argument}" != MYBILL_TEST_CONTEXT_FILE=* ]]; then unowned_arguments+=("${argument}"); fi
      done
      prepare_test "${RUN_DIRECTORY}/touch-reject-${label}.log" "${unowned_arguments[@]}" -scheme "${scheme}" -configuration "${configuration}" -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 MYBILL_TEST_CONTEXT_FILE= -only-testing:"${test_case}" -resultBundlePath "${RUN_DIRECTORY}/touch-reject-${label}.xcresult" || return
      phase test case/NativeTests/NativeSqliteTests/testRejectUnownedTestContexts "${RUN_DIRECTORY}/touch-reject-${label}.log" '' yes || return
      xcodebuild test-without-building -collect-test-diagnostics never "${TEST_ARGS[@]}" > "${RUN_DIRECTORY}/touch-reject-${label}.log" 2>&1 || rejection_status=$?
      if [[ "${rejection_status}" != 65 ]] || ! grep -Fq 'Error Domain=OwnedSimulatorTestContext Code=1' "${RUN_DIRECTORY}/touch-reject-${label}.log" || ! grep -Eq "Test Case .*${test_case##*/}.*failed" "${RUN_DIRECTORY}/touch-reject-${label}.log"; then
        tail -60 "${RUN_DIRECTORY}/touch-reject-${label}.log" >&2
        echo '缺少隔离清单的测试未按守卫预期拒绝。' >&2
        return 1
      fi
      stop_owned_app "${RUN_DIRECTORY}/touch-reject-${label}-stop.log"
      local container
      container="$(xcrun simctl get_app_container "${SIMULATOR_ID}" com.mybill.offline data)"
      python3 scripts/fixtures/dictionary-touch.py check-empty "${container}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/unused-receipt.json"
      printf '%s -> owned-context-missing -> xcodebuild=%s -> businessRowsUnchanged\n' "${label}" "${rejection_status}" >> "${RUN_DIRECTORY}/touch-guard-receipts.log"
    }
    assert_unowned_rejected App Debug NativeTests/NativeSqliteTests/testOfflineDictionaryPages hosted
    assert_unowned_rejected DictionaryTouch Release DictionaryUITests/DictionaryTouchTests/test01CreateProduct ui
    # 预期拒绝同样会建立 UI runner；重启同一受管设备，避免遗留自动化会话干扰正例。
    # 账本、归属与 UUID 保留，正例仍通过原页面执行且不增加用例时间预算。
    xcrun simctl shutdown "${SIMULATOR_ID}"
    xcrun simctl bootstatus "${SIMULATOR_ID}" -b > "${RUN_DIRECTORY}/touch-guard-reboot.log" 2>&1
    APP_CONTAINER="$(xcrun simctl get_app_container "${SIMULATOR_ID}" com.mybill.offline data)"
    # 在字典/偏好等业务触摸前保存同一安装的清空参照，T12 不从已修改的账本猜默认值。
    python3 scripts/fixtures/dictionary-touch.py capture-data-defaults "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-data-fixture.json"
    python3 scripts/fixtures/dictionary-touch.py prepare "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json"
    if ! positive_test "${RUN_DIRECTORY}/touch.log" "${XCODE_COMMON_ARGUMENTS[@]}" -scheme DictionaryTouch -configuration Release -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -skip-testing:DictionaryUITests/DictionaryTouchTests/test00DebugKeyboardReady -skip-testing:DictionaryUITests/DictionaryTouchTests/test11ProductLastPage -skip-testing:DictionaryUITests/DictionaryTouchTests/test12MergeLastPageProduct -skip-testing:DictionaryUITests/DictionaryTouchTests/test13UnitLastPage -skip-testing:DictionaryUITests/DictionaryTouchTests/test14DisableLastPageUnit -skip-testing:DictionaryUITests/DictionaryTouchTests/test15ExpenseWriteReopen -skip-testing:DictionaryUITests/DictionaryTouchTests/test16IncomeContinueEdit -skip-testing:DictionaryUITests/DictionaryTouchTests/test17ExpenseTemplateUpsert -skip-testing:DictionaryUITests/DictionaryTouchTests/test18ExpenseTemplateFill -skip-testing:DictionaryUITests/DictionaryTouchTests/test19DisableTemplateUnit -skip-testing:DictionaryUITests/DictionaryTouchTests/test20TemplateFallbackRemove -skip-testing:DictionaryUITests/DictionaryTouchTests/test21IncomeTemplateCycle -skip-testing:DictionaryUITests/DictionaryTouchTests/test22PrepareDualDrafts -skip-testing:DictionaryUITests/DictionaryTouchTests/test23SaveThemePreference -skip-testing:DictionaryUITests/DictionaryTouchTests/test24RelaunchPersonalState -skip-testing:DictionaryUITests/DictionaryTouchTests/test25ResetPreferencesKeepsDrafts -skip-testing:DictionaryUITests/DictionaryTouchTests/test26AdjustmentCreate -skip-testing:DictionaryUITests/DictionaryTouchTests/test27AdjustmentLimits -skip-testing:DictionaryUITests/DictionaryTouchTests/test28SourceTrashRestore -skip-testing:DictionaryUITests/DictionaryTouchTests/test29LinkedPurgeCancelConfirm -skip-testing:DictionaryUITests/DictionaryTouchTests/test30AutomaticCleanup -skip-testing:DictionaryUITests/DictionaryTouchTests/test31LedgerPagingSearch -skip-testing:DictionaryUITests/DictionaryTouchTests/test32LedgerFilterReset -skip-testing:DictionaryUITests/DictionaryTouchTests/test33LedgerEditReturn -skip-testing:DictionaryUITests/DictionaryTouchTests/test34LedgerUnicodeInput -skip-testing:DictionaryUITests/DictionaryTouchTests/test35LedgerUnicodePaste -skip-testing:DictionaryUITests/DictionaryTouchTests/test36ReportOverview -skip-testing:DictionaryUITests/DictionaryTouchTests/test37ReportTimeGrains -skip-testing:DictionaryUITests/DictionaryTouchTests/test38ReportDrillReturn -skip-testing:DictionaryUITests/DictionaryTouchTests/test39ReportComparison -skip-testing:DictionaryUITests/DictionaryTouchTests/test37ReportTimeGrainsQuarterYear -skip-testing:DictionaryUITests/DictionaryTouchTests/test36ReportTimePreparation -skip-testing:DictionaryUITests/DictionaryTouchTests/test00PrepareReportApp -skip-testing:DictionaryUITests/DictionaryTouchTests/test40ExpenseDimensionGroups -skip-testing:DictionaryUITests/DictionaryTouchTests/test41ExpenseDimensionAnalysis -skip-testing:DictionaryUITests/DictionaryTouchTests/test42IncomeDimensions -skip-testing:DictionaryUITests/DictionaryTouchTests/test43QualityThresholdDrill -skip-testing:DictionaryUITests/DictionaryTouchTests/test00PrepareDimensionReport -skip-testing:DictionaryUITests/DictionaryTouchTests/test40ExpensePaymentChannels -skip-testing:DictionaryUITests/DictionaryTouchTests/test40ExpenseLocations -skip-testing:DictionaryUITests/DictionaryTouchTests/test41ExpenseFrequencyQuality -skip-testing:DictionaryUITests/DictionaryTouchTests/test42IncomePayerName -skip-testing:DictionaryUITests/DictionaryTouchTests/test42IncomeFrequency -skip-testing:DictionaryUITests/DictionaryTouchTests/test45DataBackupCancel -skip-testing:DictionaryUITests/DictionaryTouchTests/test44DataCsv -skip-testing:DictionaryUITests/DictionaryTouchTests/test45DataBackupSave -skip-testing:DictionaryUITests/DictionaryTouchTests/test46DataWrongPassword -skip-testing:DictionaryUITests/DictionaryTouchTests/test47DataRestorePreviewCancel -skip-testing:DictionaryUITests/DictionaryTouchTests/test48DataRestoreConfirm -skip-testing:DictionaryUITests/DictionaryTouchTests/test49DataClearCancelConfirm -skip-testing:DictionaryUITests/DictionaryTouchTests/test50DataExternalRestore -resultBundlePath "${RUN_DIRECTORY}/touch.xcresult"; then
      tail -80 "${RUN_DIRECTORY}/touch.log" >&2
      exit 1
    fi
    # UI 用例共用一个交互会话，最后验证一次重新启动；结束 App 后才回读文件。
    stop_owned_app "${RUN_DIRECTORY}/touch-final-stop.log"
    phase check native-readback/DictionaryTouch/Release "${RUN_DIRECTORY}/touch-readback.log"
    python3 scripts/fixtures/dictionary-touch.py check "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json" | tee "${RUN_DIRECTORY}/touch-readback.log"
    python3 scripts/fixtures/dictionary-touch.py prepare-paging "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json"
    if ! positive_test "${RUN_DIRECTORY}/touch-paging.log" "${XCODE_COMMON_ARGUMENTS[@]}" -scheme DictionaryTouch -configuration Release -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -only-testing:DictionaryUITests/DictionaryTouchTests/test11ProductLastPage -only-testing:DictionaryUITests/DictionaryTouchTests/test12MergeLastPageProduct -only-testing:DictionaryUITests/DictionaryTouchTests/test13UnitLastPage -only-testing:DictionaryUITests/DictionaryTouchTests/test14DisableLastPageUnit -resultBundlePath "${RUN_DIRECTORY}/touch-paging.xcresult"; then
      tail -80 "${RUN_DIRECTORY}/touch-paging.log" >&2
      exit 1
    fi
    stop_owned_app "${RUN_DIRECTORY}/touch-paging-stop.log"
    phase check native-readback/DictionaryTouch/Release "${RUN_DIRECTORY}/touch-paging-readback.log"
    python3 scripts/fixtures/dictionary-touch.py check-paging "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json" | tee "${RUN_DIRECTORY}/touch-paging-readback.log"
    python3 scripts/fixtures/dictionary-touch.py prepare-entry "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json"
    if ! positive_test "${RUN_DIRECTORY}/touch-entry.log" "${XCODE_COMMON_ARGUMENTS[@]}" -scheme DictionaryTouch -configuration Release -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -only-testing:DictionaryUITests/DictionaryTouchTests/test15ExpenseWriteReopen -only-testing:DictionaryUITests/DictionaryTouchTests/test16IncomeContinueEdit -resultBundlePath "${RUN_DIRECTORY}/touch-entry.xcresult"; then
      tail -80 "${RUN_DIRECTORY}/touch-entry.log" >&2
      exit 1
    fi
    stop_owned_app "${RUN_DIRECTORY}/touch-entry-stop.log"
    phase check native-readback/DictionaryTouch/Release "${RUN_DIRECTORY}/touch-entry-readback.log"
    python3 scripts/fixtures/dictionary-touch.py check-entry "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json" | tee "${RUN_DIRECTORY}/touch-entry-readback.log"
    python3 scripts/fixtures/dictionary-touch.py prepare-personal "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json"
    if ! positive_test "${RUN_DIRECTORY}/touch-personal.log" "${XCODE_COMMON_ARGUMENTS[@]}" -scheme DictionaryTouch -configuration Release -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -only-testing:DictionaryUITests/DictionaryTouchTests/test17ExpenseTemplateUpsert -only-testing:DictionaryUITests/DictionaryTouchTests/test18ExpenseTemplateFill -only-testing:DictionaryUITests/DictionaryTouchTests/test19DisableTemplateUnit -only-testing:DictionaryUITests/DictionaryTouchTests/test20TemplateFallbackRemove -only-testing:DictionaryUITests/DictionaryTouchTests/test21IncomeTemplateCycle -only-testing:DictionaryUITests/DictionaryTouchTests/test22PrepareDualDrafts -only-testing:DictionaryUITests/DictionaryTouchTests/test23SaveThemePreference -only-testing:DictionaryUITests/DictionaryTouchTests/test24RelaunchPersonalState -only-testing:DictionaryUITests/DictionaryTouchTests/test25ResetPreferencesKeepsDrafts -resultBundlePath "${RUN_DIRECTORY}/touch-personal.xcresult"; then
      tail -80 "${RUN_DIRECTORY}/touch-personal.log" >&2
      exit 1
    fi
    stop_owned_app "${RUN_DIRECTORY}/touch-personal-stop.log"
    phase check native-readback/DictionaryTouch/Release "${RUN_DIRECTORY}/touch-personal-readback.log"
    python3 scripts/fixtures/dictionary-touch.py check-personal "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json" | tee "${RUN_DIRECTORY}/touch-personal-readback.log"
    python3 scripts/fixtures/dictionary-touch.py prepare-lifecycle "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json"
    if ! positive_test "${RUN_DIRECTORY}/touch-lifecycle.log" "${XCODE_COMMON_ARGUMENTS[@]}" -scheme DictionaryTouch -configuration Release -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -only-testing:DictionaryUITests/DictionaryTouchTests/test26AdjustmentCreate -only-testing:DictionaryUITests/DictionaryTouchTests/test27AdjustmentLimits -only-testing:DictionaryUITests/DictionaryTouchTests/test28SourceTrashRestore -only-testing:DictionaryUITests/DictionaryTouchTests/test29LinkedPurgeCancelConfirm -only-testing:DictionaryUITests/DictionaryTouchTests/test30AutomaticCleanup -resultBundlePath "${RUN_DIRECTORY}/touch-lifecycle.xcresult"; then
      tail -80 "${RUN_DIRECTORY}/touch-lifecycle.log" >&2
      exit 1
    fi
    stop_owned_app "${RUN_DIRECTORY}/touch-lifecycle-stop.log"
    phase check native-readback/DictionaryTouch/Release "${RUN_DIRECTORY}/touch-lifecycle-readback.log"
    python3 scripts/fixtures/dictionary-touch.py check-lifecycle "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json" | tee "${RUN_DIRECTORY}/touch-lifecycle-readback.log"
    python3 scripts/fixtures/dictionary-touch.py prepare-query "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json"
    if ! positive_test "${RUN_DIRECTORY}/touch-query.log" "${XCODE_COMMON_ARGUMENTS[@]}" -scheme DictionaryTouch -configuration Release -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -only-testing:DictionaryUITests/DictionaryTouchTests/test31LedgerPagingSearch -only-testing:DictionaryUITests/DictionaryTouchTests/test32LedgerFilterReset -only-testing:DictionaryUITests/DictionaryTouchTests/test33LedgerEditReturn -only-testing:DictionaryUITests/DictionaryTouchTests/test34LedgerUnicodeInput -only-testing:DictionaryUITests/DictionaryTouchTests/test35LedgerUnicodePaste -resultBundlePath "${RUN_DIRECTORY}/touch-query.xcresult"; then
      tail -80 "${RUN_DIRECTORY}/touch-query.log" >&2
      exit 1
    fi
    stop_owned_app "${RUN_DIRECTORY}/touch-query-stop.log"
    phase check native-readback/DictionaryTouch/Release "${RUN_DIRECTORY}/touch-query-readback.log"
    python3 scripts/fixtures/dictionary-touch.py check-query "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json" | tee "${RUN_DIRECTORY}/touch-query-readback.log"
    # 与局部入口共用绝对日期 JSON；原生页面应用同一 CUSTOM 范围，不依赖准备/执行时钟。
    python3 scripts/fixtures/dictionary-touch.py prepare-report "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json"
    if ! positive_test "${RUN_DIRECTORY}/touch-report.log" "${XCODE_COMMON_ARGUMENTS[@]}" -scheme DictionaryTouch -configuration Release -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -only-testing:DictionaryUITests/DictionaryTouchTests/test00PrepareReportApp -only-testing:DictionaryUITests/DictionaryTouchTests/test36ReportOverview -only-testing:DictionaryUITests/DictionaryTouchTests/test36ReportTimePreparation -only-testing:DictionaryUITests/DictionaryTouchTests/test37ReportTimeGrains -only-testing:DictionaryUITests/DictionaryTouchTests/test37ReportTimeGrainsQuarterYear -only-testing:DictionaryUITests/DictionaryTouchTests/test38ReportDrillReturn -only-testing:DictionaryUITests/DictionaryTouchTests/test39ReportComparison -resultBundlePath "${RUN_DIRECTORY}/touch-report.xcresult"; then
      tail -80 "${RUN_DIRECTORY}/touch-report.log" >&2
      exit 1
    fi
    stop_owned_app "${RUN_DIRECTORY}/touch-report-stop.log"
    phase check native-readback/DictionaryTouch/Release "${RUN_DIRECTORY}/touch-report-readback.log"
    python3 scripts/fixtures/dictionary-touch.py check-report "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json" | tee "${RUN_DIRECTORY}/touch-report-readback.log"
    # T11 与局部场景共用夹具和业务触摸；在 T10 读回之后准备，不污染旧固定合计。
    python3 scripts/fixtures/dictionary-touch.py prepare-dimensions "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json"
    if ! positive_test "${RUN_DIRECTORY}/touch-dimensions.log" "${XCODE_COMMON_ARGUMENTS[@]}" -scheme DictionaryTouch -configuration Release -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -only-testing:DictionaryUITests/DictionaryTouchTests/test00PrepareDimensionReport -only-testing:DictionaryUITests/DictionaryTouchTests/test40ExpenseDimensionGroups -only-testing:DictionaryUITests/DictionaryTouchTests/test41ExpenseDimensionAnalysis -only-testing:DictionaryUITests/DictionaryTouchTests/test42IncomeDimensions -only-testing:DictionaryUITests/DictionaryTouchTests/test43QualityThresholdDrill -only-testing:DictionaryUITests/DictionaryTouchTests/test40ExpensePaymentChannels -only-testing:DictionaryUITests/DictionaryTouchTests/test40ExpenseLocations -only-testing:DictionaryUITests/DictionaryTouchTests/test41ExpenseFrequencyQuality -only-testing:DictionaryUITests/DictionaryTouchTests/test42IncomePayerName -only-testing:DictionaryUITests/DictionaryTouchTests/test42IncomeFrequency -resultBundlePath "${RUN_DIRECTORY}/touch-dimensions.xcresult"; then
      tail -80 "${RUN_DIRECTORY}/touch-dimensions.log" >&2
      exit 1
    fi
    stop_owned_app "${RUN_DIRECTORY}/touch-dimensions-stop.log"
    phase check native-readback/DictionaryTouch/Release "${RUN_DIRECTORY}/touch-dimensions-readback.log"
    python3 scripts/fixtures/dictionary-touch.py check-dimensions "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-fixture.json" | tee "${RUN_DIRECTORY}/touch-dimensions-readback.log"
    python3 scripts/fixtures/dictionary-touch.py prepare-data "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-data-fixture.json"
    if ! positive_test "${RUN_DIRECTORY}/touch-data.log" "${XCODE_COMMON_ARGUMENTS[@]}" -scheme DictionaryTouch -configuration Release -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -only-testing:DictionaryUITests/DictionaryTouchTests/test45DataBackupCancel -only-testing:DictionaryUITests/DictionaryTouchTests/test44DataCsv -only-testing:DictionaryUITests/DictionaryTouchTests/test45DataBackupSave -only-testing:DictionaryUITests/DictionaryTouchTests/test46DataWrongPassword -only-testing:DictionaryUITests/DictionaryTouchTests/test47DataRestorePreviewCancel -only-testing:DictionaryUITests/DictionaryTouchTests/test48DataRestoreConfirm -only-testing:DictionaryUITests/DictionaryTouchTests/test49DataClearCancelConfirm -only-testing:DictionaryUITests/DictionaryTouchTests/test50DataExternalRestore -resultBundlePath "${RUN_DIRECTORY}/touch-data.xcresult"; then
      tail -80 "${RUN_DIRECTORY}/touch-data.log" >&2
      exit 1
    fi
    stop_owned_app "${RUN_DIRECTORY}/touch-data-stop.log"
    phase check native-readback/DictionaryTouch/Release "${RUN_DIRECTORY}/touch-data-readback.log"
    python3 scripts/fixtures/dictionary-touch.py check-data "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-data-fixture.json" | tee "${RUN_DIRECTORY}/touch-data-readback.log"
    run_phase check check/resources/simulator "${RUN_DIRECTORY}/simulator-resources.log" '' node scripts/verify-ios-resources.mjs .local/ios/DerivedData/Build/Products/Release-iphonesimulator/App.app
    sed -n '/DICTIONARY_TOUCH_/p; /LEDGER_QUERY_TOUCH_/p; /REPORT_TOUCH_/p; /REPORT_DIMENSION_/p; /REPORT_QUALITY_/p; /DATA_MANAGEMENT_/p; /Executed .* tests\{0,1\}, with/p; /\*\* TEST SUCCEEDED \*\*/p' "${RUN_DIRECTORY}/touch.log" "${RUN_DIRECTORY}/touch-paging.log" "${RUN_DIRECTORY}/touch-entry.log" "${RUN_DIRECTORY}/touch-personal.log" "${RUN_DIRECTORY}/touch-lifecycle.log" "${RUN_DIRECTORY}/touch-query.log" "${RUN_DIRECTORY}/touch-report.log" "${RUN_DIRECTORY}/touch-dimensions.log" "${RUN_DIRECTORY}/touch-data.log"
    exit 0
  fi
  if [[ "${MODE}" != ios-recovery ]]; then
  if ! positive_test "${RUN_DIRECTORY}/test.log" "${XCODE_ARGUMENTS[@]}" -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -test-timeouts-enabled YES -maximum-test-execution-time-allowance 60 -skip-testing:NativeTests/NativeSqliteTests/testOfflineDictionaryScenario -skip-testing:NativeTests/NativeSqliteTests/testPrepareProcessInterruption -skip-testing:NativeTests/NativeSqliteTests/testRecoverProcessInterruption -resultBundlePath "${RUN_DIRECTORY}/native.xcresult"; then
    tail -60 "${RUN_DIRECTORY}/test.log" >&2
    exit 1
  fi
  fi
  # 只对本轮模拟器的正式迁移路径分阶段中断；请求及信号只供 test bundle 消费。
  CRASH_PHASES=(snapshot-ready migration-recorded upgrade-committed)
  if [[ "${MODE}" == ios-recovery ]]; then IFS=',' read -r -a CRASH_PHASES <<< "${MYBILL_RECOVERY_PHASES}"; fi
  for CRASH_PHASE in "${CRASH_PHASES[@]}"; do
    RECOVERY_COVERAGE="recovery/${CRASH_PHASE}"
    APP_CONTAINER="$(xcrun simctl get_app_container "${SIMULATOR_ID}" com.mybill.offline data)"
    printf '%s' "${CRASH_PHASE}" > "${APP_CONTAINER}/Library/Caches/ledger-crash-request"
    prepare_test "${RUN_DIRECTORY}/interruption-${CRASH_PHASE}.log" "${XCODE_ARGUMENTS[@]}" -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -only-testing:NativeTests/NativeSqliteTests/testPrepareProcessInterruption -resultBundlePath "${RUN_DIRECTORY}/interruption-${CRASH_PHASE}.xcresult"
    phase test "${RECOVERY_COVERAGE}" "${RUN_DIRECTORY}/interruption-${CRASH_PHASE}.log" '' yes
    xcodebuild test-without-building -collect-test-diagnostics never "${TEST_ARGS[@]}" > "${RUN_DIRECTORY}/interruption-${CRASH_PHASE}.log" 2>&1 &
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
    if ! positive_test "${RUN_DIRECTORY}/recovery-${CRASH_PHASE}.log" "${XCODE_ARGUMENTS[@]}" -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" -parallel-testing-enabled NO -only-testing:NativeTests/NativeSqliteTests/testRecoverProcessInterruption -resultBundlePath "${RUN_DIRECTORY}/recovery-${CRASH_PHASE}.xcresult"; then
      tail -40 "${RUN_DIRECTORY}/recovery-${CRASH_PHASE}.log" >&2
      exit 1
    fi
    sed -n '/LEDGER_PROCESS_INTERRUPTION_RECOVERED/p' "${RUN_DIRECTORY}/recovery-${CRASH_PHASE}.log"
  done
  if [[ "${MODE}" == ios-recovery ]]; then exit 0; fi
  # 输出固定探针结果，不打印数据库内容或真实设备信息。
  sed -n '/NATIVE_SQLITE_EVIDENCE/p; /LEDGER_LIFECYCLE_EVIDENCE/p; /IPHONE_SHELL_EVIDENCE/p; /OFFLINE_DICTIONARY_EVIDENCE/p; /OFFLINE_DICTIONARY_UI_EVIDENCE/p; /OFFLINE_ENTRY_EVIDENCE/p; /OFFLINE_CLEANUP_FINALIZATION_EVIDENCE/p; /OFFLINE_CLEANUP_FOREGROUND_STATE_VERIFIED/p; /NATIVE_LIFECYCLE_DRAFT_WINDOW_VERIFIED/p; /OFFLINE_LEDGER_QUERY_EVIDENCE/p; /OFFLINE_CORE_REPORT_EVIDENCE/p; /OFFLINE_DIMENSION_REPORT_EVIDENCE/p; /Executed .* tests\{0,1\}, with/p; /\*\* TEST SUCCEEDED \*\*/p' "${RUN_DIRECTORY}/test.log"
fi
