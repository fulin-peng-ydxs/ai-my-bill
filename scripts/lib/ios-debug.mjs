import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const APP_ID = 'com.mybill.offline'
export const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0'
export const DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-14-Pro-Max'
export const capacityColdCases = Array.from({ length:5 },(_,i) => `CapacityColdTests/CapacityColdTests/testColdLaunch0${i+1}`)
export const capacityScenarios = [10000,100000].flatMap(count => ['', '-prepare','-native','-pages','-cold',...capacityColdCases.map((_,i) => '-cold-0'+(i+1))].map(phase => 'scale-'+count+phase))
export const nativeCases = [
  'testIosInteractionMatrix',
  'testIosTextScale',
  'testIosStatusBarTheme',
  'testBundledEntryAndNativeSqliteBridge',
  'testClosedDatabaseSidecarPolicy',
  'testLedgerLifecycleAndProtection',
  'testOfflineDictionaryGovernance',
  'testOfflineDictionaryPages',
  'testOfflineEntryWrites',
  'testOfflinePersonalState',
  'testOfflineAdjustmentLifecycle',
  'testOfflineLedgerQuery',
  'testOfflineCoreReports',
  'testOfflineDimensionReports',
  'testOfflineDataManagement',
  'testDataFileSecurityAndSwitchRecovery',
  'testOfflineCleanupFinalization',
  'testOfflineCleanupForegroundState',
  'testNativeLifecycleDraftWindow',
  'testOriginalShellNavigationAndOverlays',
  'testRejectUnownedTestContexts'
]
export const uiCases = [
  'test00EightOriginalEntries',
  'test01CreateProduct',
  'test02RenameProduct',
  'test03CreateCategory',
  'test04CreateUnit',
  'test05CreateFunding',
  'test06DisableCandidates',
  'test07RestoreCandidates',
  'test08MergeCancel',
  'test09MergeConfirm',
  'test10RelaunchedMergeCandidates',
  'test11ProductLastPage',
  'test12MergeLastPageProduct',
  'test13UnitLastPage',
  'test14DisableLastPageUnit',
  'test15ExpenseWriteReopen',
  'test16IncomeContinueEdit',
  'test17ExpenseTemplateUpsert',
  'test18ExpenseTemplateFill',
  'test19DisableTemplateUnit',
  'test20TemplateFallbackRemove',
  'test21IncomeTemplateCycle',
  'test22PrepareDualDrafts',
  'test23SaveThemePreference',
  'test24RelaunchPersonalState',
  'test25ResetPreferencesKeepsDrafts',
  'test26AdjustmentCreate',
  'test27AdjustmentLimits',
  'test28SourceTrashRestore',
  'test29LinkedPurgeCancelConfirm',
  'test30AutomaticCleanup',
  'test31LedgerPagingSearch',
  'test32LedgerFilterReset',
  'test33LedgerEditReturn',
  'test34LedgerUnicodeInput',
  'test35LedgerUnicodePaste',
  'test36ReportOverview',
  'test37ReportTimeGrains',
  'test38ReportDrillReturn',
  'test39ReportComparison',
  'test37ReportTimeGrainsQuarterYear',
  'test36ReportTimePreparation',
  'test00PrepareReportApp',
  'test40ExpenseDimensionGroups',
  'test41ExpenseDimensionAnalysis',
  'test42IncomeDimensions',
  'test43QualityThresholdDrill',
  'test00PrepareDimensionReport',
  'test40ExpensePaymentChannels',
  'test40ExpenseLocations',
  'test41ExpenseFrequencyQuality',
  'test42IncomePayerName',
  'test42IncomeFrequency',
  'test44DataCsv','test45DataBackupSave','test46DataWrongPassword','test47DataRestorePreviewCancel',
  'test48DataRestoreConfirm','test49DataClearCancelConfirm','test50DataExternalRestore','test45DataBackupCancel',
  'test51IosKeyboardNavigation','test52IosCandidatesAndDate','test53IosLandscapeCandidates'
]

export const recoveryPhases = ['snapshot-ready', 'migration-recorded', 'upgrade-committed']
export const recoveryScenarios = [...recoveryPhases.map((p) => 'interruption-' + p), 'interruption-all']

export const uiScenarios = {
  'ios-interaction':[61,62,63],
  'ios-candidates':[62,63],
  'paging-merge': [11, 12],
  'paging-disable': [13, 14],
  'merge-relaunch': [9, 10],
  'merge-cycle': [8, 9, 10],
  'entry-cycle': [15, 16],
  'template-cycle': [17, 18, 19, 20, 21],
  'draft-relaunch': [22, 23, 24, 25],
  'personal-cycle': [17, 18, 19, 20, 21, 22, 23, 24, 25],
  'adjustment-cycle': [26, 27, 28],
  'lifecycle-cycle': [26, 27, 28, 29, 30],
  'cleanup-relaunch': [30],
  'query-cycle': [31, 32, 33],
  'query-input': [34, 35],
  'report-cycle': [42, 36, 41, 37, 40, 38, 39],
  'report-overview-grains': [42, 36, 41, 37, 40],
  'report-grains': [42, 41, 37, 40],
  'report-dimensions': [47, 43, 48, 49, 44, 50, 45, 51, 52, 46],
  'report-expense-groups': [47, 43, 48, 49],
  'report-expense-analysis': [47, 44, 50],
  'report-income-dimensions': [47, 45, 51, 52],
  'report-quality': [47, 46],
  'data-cycle': [53,60,54,55,56,57,58,59],
  'data-backup': [60,54],
  'data-restore': [60,54,55,56,57],
  'data-restore-clear': [60,54,56,57,58,59],
  'data-clear': [60,54,58,59],
  'report-dimension-details': [47, 50, 45, 51, 52, 46]
}

/** 启动请求失败也可能遗留桥接会话；后续准备失败不能遮住历史故障。 */
export function needsSimulatorRecovery(directory) {
  const previous = fs.readdirSync(directory)
    .filter(name => /^run-[A-Za-z0-9]+$/.test(name))
    .sort((a, b) => fs.statSync(path.join(directory, a)).birthtimeMs - fs.statSync(path.join(directory, b)).birthtimeMs)
    .findLast(name => {
      const run = path.join(directory, name)
      if (['test.log','capacity-cold.log'].some(file => fs.existsSync(path.join(run,file)))) return true
      // 尚未进入 XCTest 的启动超时/中断同样需要恢复。夹具已开始则启动和终止已完成，
      // 不因夹具拒绝而额外重启；仍继续追溯更早的自动化或启动故障。
      const uiLaunch = fs.existsSync(path.join(run, 'ui-launch.log'))
      if (!uiLaunch && (!fs.existsSync(path.join(run, 'initialize-launch.log')) || fs.existsSync(path.join(run, 'fixture.log')))) return false
      const result = path.join(run, 'result.json')
      return !fs.existsSync(result) || JSON.parse(fs.readFileSync(result, 'utf8')).failure?.stage === 'initialize'
    })
  if (!previous) return false
  const result = path.join(directory, previous, 'result.json')
  return !fs.existsSync(result) || JSON.parse(fs.readFileSync(result, 'utf8')).status !== 'passed'
}

/** 前置用例显式列出；只补必要环境与导航，不能暗中扩展为完整触摸套件。 */
export function selection(kind, name, nativeScenarios) {
  if (kind === '--scenario') {
    if (name === 'ios-review') return { scheme:'App',configuration:'Debug',cases:[
      'testIosInteractionMatrix','testIosStatusBarTheme','testIosTextScale','testOriginalShellNavigationAndOverlays'
    ].map(name => 'NativeTests/NativeSqliteTests/'+name) }
    if (capacityScenarios.includes(name)) {
      const [,count,phase = 'all',sample] = name.split('-'), cases = [
        'CapacityTests/CapacityTests/testPrepareCapacityFixture','CapacityTests/CapacityTests/testNativeCapacity',
        'CapacityTests/CapacityTests/testPageCapacity',...capacityColdCases]
      return { scheme:'Capacity',configuration:'Release',capacity:Number(count),capacityPhase:phase,
        ...(sample ? { capacityColdIndices:[Number(sample)-1] } : {}),
        appId:'com.mybill.offline.capacity',testCaseMs:['prepare','cold'].includes(phase) ? 60_000 : 600_000,
        cases:phase === 'all' ? cases : phase === 'cold' ? (sample ? [capacityColdCases[Number(sample)-1]] : capacityColdCases) : [cases[['prepare','native','pages'].indexOf(phase)]] }
    }
    if (recoveryScenarios.includes(name))
      return {
        scheme: 'App',
        configuration: 'Debug',
        recoveryPhases: name === 'interruption-all' ? recoveryPhases : [name.slice('interruption-'.length)],
        cases: [
          'NativeTests/NativeSqliteTests/testPrepareProcessInterruption',
          'NativeTests/NativeSqliteTests/testRecoverProcessInterruption'
        ]
      }
    if (nativeScenarios.includes(name))
      return {
        scheme: 'App',
        configuration: 'Debug',
        scenario: name,
        cases: ['NativeTests/NativeSqliteTests/testOfflineDictionaryScenario']
      }
    if (Object.hasOwn(uiScenarios, name)) return uiSelection(uiScenarios[name])
  } else if (kind === '--case') {
    const parts = name.split('/')
    if (
      parts.length === 3 &&
      parts[0] === 'NativeTests' &&
      parts[1] === 'NativeSqliteTests' &&
      nativeCases.includes(parts[2])
    ) {
      return { scheme: 'App', configuration: 'Debug', cases: [name] }
    }
    if (parts.length === 3 && parts[0] === 'DictionaryUITests' && parts[1] === 'DictionaryTouchTests') {
      const index = uiCases.indexOf(parts[2])
      if (index >= 0)
        return uiSelection(
          index === 10 ? [9, 10] : index === 12 ? [11, 12] : index === 14 ? [13, 14]
            : index === 18 ? [17, 18] : index === 20 ? [17, 19, 20]
              : index === 27 ? [26, 27] : index === 28 ? [26, 28] : index === 29 ? [26, 28, 29]
              : index === 24 ? [22, 23, 24] : index === 25 ? [22, 23, 24, 25]
                : index === 36 ? [42, 36] : [37, 38, 39, 40].includes(index) ? [42, 41, index] : index === 41 ? [42, 41]
                  : index === 53 ? [53] : index === 60 ? [60] : index === 54 ? [60,54] : index === 55 ? [60,54,55] : index === 56 ? [60,54,56] : index === 57 ? [60,54,56,57]
                  : index === 58 ? [60,54,58] : index === 59 ? [60,54,58,59]
                  : index >= 43 && index < 53 && index !== 47 ? [47, index] : [index]
        )
    }
  }
  throw new Error('未知用例或场景；使用 debug list 查看允许项，不接受任意测试过滤器。')
}
function uiSelection(indices) {
  if (indices.every(index => index >= 61)) return { scheme:'DictionaryTouch',configuration:'Release',
    cases:indices.map(index => 'DictionaryUITests/DictionaryTouchTests/'+uiCases[index]) }
  return {
    scheme: 'DictionaryTouch',
    configuration: 'Release',
    fixture: indices.some(i => i >= 53) ? 'data-' + indices.join(',') : indices.some(i => i >= 36) ? 'report-' + indices.join(',')
      : indices.some(i => i >= 31) ? 'query-' + indices.join(',')
      : indices.some(i => i >= 26) ? 'lifecycle-' + indices.join(',')
      : indices.some(i => i >= 17) ? 'personal-' + indices.join(',')
      : indices.includes(15) && indices.includes(16) ? 'entry-cycle' : String(indices.at(-1)),
    cases: [
      // 只为实际输入场景保留键盘前置；只读报表粒度不串入明细搜索键盘验收。
      ...(indices.some((i) => (i >= 1 && i <= 5) || i === 11 || i === 13 || (i >= 15 && i <= 35) || i === 38 || i >= 53)
        ? ['DictionaryUITests/DictionaryTouchTests/test00DebugKeyboardReady']
        : []),
      ...indices.map((i) => `DictionaryUITests/DictionaryTouchTests/${uiCases[i]}`)
    ]
  }
}

/** 只接受当前仓库受管根下的真实会话目录，拒绝任意路径、符号链接和闭合会话。 */
export function readSession(root, input, allowClosed = false) {
  const directory = path.resolve(input)
  if (
    path.dirname(directory) !== fs.realpathSync(root) ||
    !/^ios-debug-[A-Za-z0-9]+$/.test(path.basename(directory)) ||
    fs.realpathSync(directory) !== directory
  )
    throw new Error('拒绝非本仓库调试会话路径。')
  const file = path.join(directory, 'test-context.json')
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > 4096)
    throw new Error('调试清单类型、权限或大小不合法。')
  const context = JSON.parse(fs.readFileSync(file, 'utf8'))
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
  if (
    context.kind !== 'ios-debug' ||
    context.schema !== 1 ||
    context.appId !== APP_ID ||
    !uuid.test(context.runId) ||
    !uuid.test(context.simulatorId) ||
    context.name !== `我的账单调试-${context.runId}` ||
    !['open', ...(allowClosed ? ['closed'] : [])].includes(context.state)
  )
    throw new Error('调试会话清单不合法或已关闭。')
  return { directory, context, file }
}
export function assertDevice(context, inventory) {
  const device = inventory.devices[RUNTIME]?.find((d) => d.udid === context.simulatorId)
  if (
    !device ||
    !device.isAvailable ||
    device.name !== context.name ||
    device.deviceTypeIdentifier !== DEVICE_TYPE
  ) {
    throw new Error('调试设备已丢失或与本轮清单不匹配；拒绝接管其他设备。')
  }
  return device
}

/** 输入和产物都以内容摘要校验；不能只凭 mtime 或存在一个 App.app 就复用。 */
export function hashPaths(root, inputs, excluded = () => false) {
  const hash = createHash('sha256')
  function visit(relative) {
    if (excluded(relative)) return
    const absolute = path.join(root, relative)
    const stat = fs.lstatSync(absolute)
    if (stat.isSymbolicLink()) {
      hash.update(relative + '\0link\0' + fs.readlinkSync(absolute))
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name))
    } else if (stat.isFile()) {
      hash.update(relative + '\0')
      hash.update(fs.readFileSync(absolute))
    }
  }
  for (const input of [...inputs].sort()) visit(input)
  return hash.digest('hex')
}
export function sourceHash(root, toolchain) {
  const digest = hashPaths(
    root,
    [
      'app/src',
      ...['app/index.html', 'app/public', 'app/vitest.config.ts'].filter(p => fs.existsSync(path.join(root, p))),
      'app/native-tests',
      'app/test-support',
      'app/ios/App',
      'app/package.json',
      'app/package-lock.json',
      'app/capacitor.config.ts',
      'app/vite.config.ts',
      'app/tsconfig.json',
      'app/tsconfig.tools.json',
      'scripts/normalize-capacitor-spm.mjs'
    ],
    (p) =>
      p.includes('/CapApp-SPM') ||
      p.includes('/App/public') ||
      p.includes('/xcuserdata') ||
      p.endsWith('/capacitor.config.json') ||
      p.endsWith('/config.xml') ||
      path.basename(p) === '.DS_Store'
  )
  return createHash('sha256')
    .update(digest + '\0' + toolchain)
    .digest('hex')
}
