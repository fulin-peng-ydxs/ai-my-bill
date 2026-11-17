import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const APP_ID = 'com.mybill.offline'
export const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0'
export const DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-14-Pro-Max'
export const nativeCases = [
  'testBundledEntryAndNativeSqliteBridge',
  'testClosedDatabaseSidecarPolicy',
  'testLedgerLifecycleAndProtection',
  'testOfflineDictionaryGovernance',
  'testOfflineDictionaryPages',
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
  'test14DisableLastPageUnit'
]

export const recoveryPhases = ['snapshot-ready', 'migration-recorded', 'upgrade-committed']
export const recoveryScenarios = [...recoveryPhases.map((p) => 'interruption-' + p), 'interruption-all']

export const uiScenarios = {
  'paging-merge': [11, 12],
  'paging-disable': [13, 14],
  'merge-relaunch': [9, 10],
  'merge-cycle': [8, 9, 10]
}

/** 前置用例显式列出；只补必要环境与导航，不能暗中扩展为完整触摸套件。 */
export function selection(kind, name, nativeScenarios) {
  if (kind === '--scenario') {
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
          index === 10 ? [9, 10] : index === 12 ? [11, 12] : index === 14 ? [13, 14] : [index]
        )
    }
  }
  throw new Error('未知用例或场景；使用 debug list 查看允许项，不接受任意测试过滤器。')
}
function uiSelection(indices) {
  return {
    scheme: 'DictionaryTouch',
    configuration: 'Release',
    fixture: String(indices.at(-1)),
    cases: [
      ...(indices.some((i) => (i >= 1 && i <= 5) || i === 11 || i === 13)
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
