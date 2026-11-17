import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { constants, release } from 'node:os'
import {
  APP_ID,
  RUNTIME,
  DEVICE_TYPE,
  nativeCases,
  uiCases,
  uiScenarios,
  recoveryScenarios,
  selection,
  readSession,
  assertDevice,
  hashPaths,
  sourceHash
} from './lib/ios-debug.mjs'
import {
  verificationHash,
  inputHash,
  requireEvidenceSet,
  beginFull,
  finishFull,
  observeFull,
  startPhase,
  finishPhases,
  recordLocal,
  failureDetails,
  readVitest,
  caseKey,
  budgets,
  writeJson,
  needsPhaseRepair,
  selectedCoverage
} from './lib/ios-verification.mjs'

import { checkNames, checkDefinition } from './lib/ios-checks.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = path.join(root, '.local/ios/tmp/ai-agent')
const scenarios = JSON.parse(fs.readFileSync(path.join(root, 'app/native-tests/scenarios.json'), 'utf8'))
let child
let phaseObserver
let interrupted
let cancellationTimer
function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = signal
    if (child) {
      const pid = child.pid
      killGroup(pid, signal)
      clearTimeout(cancellationTimer)
      cancellationTimer = setTimeout(() => killGroup(pid, 'SIGKILL'), 10_000)
    }
  })

async function command(
  program,
  args,
  {
    log,
    timeout = 300_000,
    accept = [0],
    input,
    inherit = false,
    env = process.env,
    observer = phaseObserver
  } = {}
) {
  if (interrupted) throw new Error(`已取消：${interrupted}`)
  const output = log ? fs.openSync(log, 'wx', 0o600) : undefined
  let text = ''
  let timedOut = false
  let inputError
  let timer
  let watching
  let observationError
  const stop = (error) => {
    if (observationError) return
    observationError = error
    const pid = child.pid
    killGroup(pid, 'SIGTERM')
    cancellationTimer = setTimeout(() => killGroup(pid, 'SIGKILL'), 10_000)
  }
  try {
    const status = await new Promise((resolve, reject) => {
      child = spawn(program, args, {
        cwd: root,
        env,
        detached: true,
        stdio: [
          input === undefined ? 'ignore' : 'pipe',
          inherit ? 'inherit' : (output ?? 'pipe'),
          inherit ? 'inherit' : (output ?? 'pipe')
        ]
      })
      if (input !== undefined) {
        child.stdin.on('error', (error) => {
          inputError = error
        })
        child.stdin.end(input)
      }
      if (!log && !inherit)
        for (const stream of [child.stdout, child.stderr])
          stream.on('data', (data) => {
            text += data.toString()
            if (text.length > 1_048_576) {
              timedOut = true
              killGroup(child.pid, 'SIGKILL')
            }
          })
      timer = setTimeout(() => {
        timedOut = true
        stop(new Error(`${program} 超过执行预算，停止并保留失败证据。`))
      }, timeout)
      if (observer)
        watching = setInterval(() => {
          try {
            observer.poll()
          } catch (error) {
            stop(error)
          }
        }, 100)
      child.once('error', reject)
      child.once('close', (code, signal) => resolve(code ?? 128 + (constants.signals[signal] ?? 0)))
    })
    if (observer && !observationError) {
      try {
        observer.poll()
      } catch (error) {
        observationError = error
      }
    }
    if (observationError) throw observationError
    // common/touch 可以在已完成门禁后正常提前 exit；仅此类成功退出允许输入端 EPIPE。
    if (interrupted || timedOut || (inputError && inputError.code !== 'EPIPE') || !accept.includes(status)) {
      throw new Error(
        `${program} 未通过（exit=${status}${timedOut ? ', timeout/output-limit' : ''}）${log ? `，日志：${log}` : `：${text.trim()}`}`
      )
    }
    return { status, text }
  } finally {
    clearTimeout(timer)
    clearInterval(watching)
    clearTimeout(cancellationTimer)
    child = undefined
    if (output !== undefined) fs.closeSync(output)
  }
}
const simctl = (...args) => command('xcrun', ['simctl', ...args])
const writeContext = (session) =>
  fs.writeFileSync(session.file, JSON.stringify(session.context), { mode: 0o600 })
const inventory = async () => JSON.parse((await simctl('list', 'devices', '--json')).text)
async function selectDeveloperTools() {
  if (
    process.platform === 'darwin' &&
    !process.env.DEVELOPER_DIR &&
    (await command('xcode-select', ['-p'])).text.trim() === '/Library/Developer/CommandLineTools' &&
    fs.existsSync('/Applications/Xcode.app')
  )
    process.env.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer'
}
async function nativeToolchain() {
  await selectDeveloperTools()
  const sdk = (await command('xcrun', ['--sdk', 'iphoneos', '--show-sdk-version'])).text.trim()
  if (!/^27\./.test(sdk)) throw new Error('需要 Xcode / iOS 27 SDK。')
  const runtimes = JSON.parse((await command('xcrun', ['simctl', 'list', 'runtimes', '--json'])).text)
  const runtime = runtimes.runtimes.find((r) => r.identifier === RUNTIME && r.isAvailable)
  if (!runtime) throw new Error('需要可用的 iOS 27.0 simulator runtime。')
  return JSON.stringify({
    sdk,
    xcode: (await command('xcodebuild', ['-version'])).text,
    node: process.version,
    arch: process.arch,
    host: release(),
    runtime: runtime.buildversion
  })
}

async function tracked(run, stage, coverage, program, args, options = {}) {
  startPhase(run, { stage, coverage, log: options.log, report: options.report, scenario: options.scenario })
  return command(program, args, { ...options, timeout: options.timeout ?? budgets[stage] ?? 900_000 })
}

async function runCheck(args) {
  const options = {}
  for (let i = 2; i < args.length; i += 2) {
    if (
      !['--check', '--file', '--name', '--target', '--scheme', '--configuration'].includes(args[i]) ||
      !args[i + 1] ||
      Object.hasOwn(options, args[i])
    )
      throw new Error('debug check 参数无效。')
    options[args[i]] = args[i + 1]
  }
  const run = fs.mkdtempSync(path.join(temporary, 'ios-check-'))
  const name = options['--check']
  const checkOptions = Object.fromEntries(
    Object.entries(options)
      .filter(([k]) => k !== '--check')
      .map(([k, v]) => [k.slice(2), v])
  )
  let selected
  try {
    selected = checkDefinition(root, run, name, checkOptions)
  } catch (error) {
    fs.rmdirSync(run)
    throw error
  }
  const inputs = inputHash(root)
  let environment
  const result = {
    scope: 'partial',
    check: name,
    status: 'failed',
    inputHash: inputs,
    options: checkOptions,
    coverage: selected.coverage,
    startedAt: Date.now()
  }
  phaseObserver = observeFull({ run, root, evidenceRoot: temporary })
  try {
    if (selected.native) {
      startPhase(run, { stage: 'build', coverage: selected.coverage, log: selected.log })
      environment = await nativeToolchain()
      result.environment = environment
    }
    await tracked(run, selected.stage, selected.coverage, selected.program, selected.args, selected)
    result.command = { program: path.basename(selected.program), args: selected.args, exit: 0 }
    if (name === 'app-tests') {
      const parsed = readVitest(selected.report, root)
      if (!parsed.passed.length || parsed.failed.length)
        throw new Error('局部 Vitest 未命中或未通过实际目标。')
      result.coverage = [
        ...parsed.passed,
        ...(options['--file'] || options['--name'] ? [] : ['check/app-tests'])
      ]
    }
    if (inputHash(root) !== inputs) throw new Error('局部执行期间输入变化，不能作为当前版本证据。')
    result.status = 'passed'
  } catch (error) {
    result.error = error.message
    result.cancelled = Boolean(interrupted)
    result.failure = failureDetails({ run, root })
    if (name === 'app-tests') {
      const parsed = readVitest(selected.report, root)
      // 未命中与纯取消是执行缺口，不伪装成新出现的业务失败来解锁完整重跑。
      if (!parsed.failed.length) result.failure.observed = false
    }
    throw error
  } finally {
    result.completedAt = Date.now()
    result.timings = finishPhases(run, result.status === 'passed' ? undefined : new Error(result.error))
    phaseObserver = undefined
    writeJson(path.join(run, 'result.json'), result)
    recordLocal(root, run, result)
    console.log(`局部检查证据：${run}`)
    if (result.status === 'passed') console.log(`EVIDENCE=${run}`)
  }
}

async function stopApp(id, log) {
  const { status, text } = await command('xcrun', ['simctl', 'terminate', id, APP_ID], { accept: [0, 3] })
  fs.writeFileSync(log, text)
  if (status === 3 && !text.includes('found nothing to terminate'))
    throw new Error('结束本轮 App 失败，拒绝夹具读写。')
}
function needsRepair(key, environment) {
  return needsPhaseRepair(root, key, environment)
}
async function prepareBuild(session, selected, run, toolchain) {
  const derived = path.join(session.directory, 'DerivedData', selected.configuration)
  const products = path.join(derived, 'Build/Products')
  const receiptFile = path.join(session.directory, `build-${selected.configuration}.json`)
  const fingerprint = sourceHash(root, toolchain)
  let receipt
  if (fs.existsSync(receiptFile)) receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
  if (
    !needsRepair(`native-build/${selected.scheme}/${selected.configuration}`, toolchain) &&
    receipt?.sourceHash === fingerprint &&
    fs.existsSync(products) &&
    receipt.productHash === hashPaths(products, ['.'])
  ) {
    console.log('BUILD_CACHE_HIT：源码、工具链和测试产物摘要一致；使用 test-without-building。')
    return { ...receipt, cacheHit: true, products }
  }
  // 失败先使旧凭据失效，未完整生成的产物不能在下次命令里被当作缓存。
  fs.rmSync(receiptFile, { force: true })
  console.log('BUILD_CACHE_MISS：生成当前资源及所选测试 target。')
  await tracked(run, 'build', ['check/app-build'], 'npm', ['--prefix', 'app', 'run', 'native:sync'], {
    log: path.join(run, 'sync.log')
  })
  await tracked(run, 'build', ['check/probe-build'], 'npm', ['--prefix', 'app', 'run', 'probe:bundle'], {
    log: path.join(run, 'probe.log')
  })
  await tracked(run, 'check', ['check/resources/source'], 'node', ['scripts/verify-ios-resources.mjs'], {
    log: path.join(run, 'resources.log')
  })
  await tracked(
    run,
    'build',
    [`native-build/${selected.scheme}/${selected.configuration}`],
    'xcodebuild',
    [
      'build-for-testing',
      '-project',
      'app/ios/App/App.xcodeproj',
      '-scheme',
      selected.scheme,
      '-configuration',
      selected.configuration,
      '-destination',
      `platform=iOS Simulator,id=${session.context.simulatorId}`,
      '-derivedDataPath',
      derived,
      '-clonedSourcePackagesDirPath',
      '.local/ios/SourcePackages',
      '-disableAutomaticPackageResolution',
      'CODE_SIGNING_ALLOWED=NO',
      `MYBILL_TEST_CONTEXT_FILE=${session.file}`
    ],
    { log: path.join(run, 'build.log'), timeout: budgets.build }
  )
  const plans = fs.readdirSync(products).filter((name) => name.endsWith('.xctestrun'))
  if (plans.length !== 1) throw new Error('未找到唯一的本轮测试运行清单。')
  receipt = {
    sourceHash: sourceHash(root, toolchain),
    productHash: hashPaths(products, ['.']),
    plan: path.join(products, plans[0])
  }
  if (receipt.sourceHash !== fingerprint)
    throw new Error('构建期间源码或配置发生变化，拒绝复用或验证混合版本。')
  fs.writeFileSync(receiptFile, JSON.stringify(receipt))
  return { ...receipt, cacheHit: false, products }
}

async function runPartial(session, selected, toolchain, requested) {
  const device = assertDevice(session.context, await inventory())
  const previousRuns = fs
    .readdirSync(session.directory)
    .filter((name) => /^run-[A-Za-z0-9]+$/.test(name))
    .sort(
      (a, b) =>
        fs.statSync(path.join(session.directory, a)).birthtimeMs -
        fs.statSync(path.join(session.directory, b)).birthtimeMs
    )
  const previous = previousRuns.at(-1)
  const previousResult = previous && path.join(session.directory, previous, 'result.json')
  const needsRecovery =
    previousResult &&
    fs.existsSync(path.join(session.directory, previous, 'test.log')) &&
    (!fs.existsSync(previousResult) ||
      JSON.parse(fs.readFileSync(previousResult, 'utf8')).status !== 'passed')
  const run = fs.mkdtempSync(path.join(session.directory, 'run-'))
  const started = Date.now()
  let result = {
    scope: 'partial',
    requested,
    executedCases: selected.cases,
    configuration: selected.configuration,
    status: 'failed',
    simulatorId: device.udid,
    runId: session.context.runId
  }
  console.log(
    `请求：${requested.kind} ${requested.name}\n实际局部用例：${selected.cases.join(', ')}\n证据：${run}`
  )
  try {
    result.inputHash = inputHash(root)
    result.environment = toolchain
    result.coverage = []
    result.verificationHash = verificationHash(root, toolchain)
    phaseObserver = observeFull({ run, root, evidenceRoot: temporary })
    if (selected.recoveryPhases) {
      writeJson(path.join(run, 'active.json'), {
        ownerPid: process.pid,
        runId: session.context.runId,
        recoveryPhases: selected.recoveryPhases
      })
      const script = fs.readFileSync(path.join(root, 'scripts/lib/ios-app-full.sh'), 'utf8')
      await command('bash', ['-n'], { input: script })
      await command('bash', ['-s', '--', 'ios-recovery'], {
        input: script,
        log: path.join(run, 'test.log'),
        timeout: 900_000,
        env: {
          ...process.env,
          MYBILL_FULL_SESSION: session.directory,
          MYBILL_FULL_ATTEMPT: run,
          MYBILL_RECOVERY_PHASES: selected.recoveryPhases.join(',')
        }
      })
      const log = fs.readFileSync(path.join(run, 'test.log'), 'utf8')
      for (const p of selected.recoveryPhases)
        if (!log.includes('LEDGER_PROCESS_INTERRUPTION_RECOVERED ' + p))
          throw new Error('成对恢复未完成：' + p)
      if (verificationHash(root, toolchain) !== result.verificationHash)
        throw new Error('恢复期间执行输入变化。')
      result.coverage = [
        ...new Set([
          ...selected.recoveryPhases.map((p) => 'recovery/' + p),
          ...finishPhases(run).flatMap((p) => p.coverage)
        ])
      ]
      result.status = 'passed'
      return
    }
    startPhase(run, { stage: 'boot', coverage: ['native-boot'], log: path.join(run, 'boot.log') })
    // 失败的 UI 自动化会话可能在 launchd 中遗留 runner；只重启本轮设备，保留 UUID 和产物。
    if (needsRecovery && selected.scheme === 'DictionaryTouch' && device.state !== 'Shutdown') {
      await command('xcrun', ['simctl', 'shutdown', device.udid], {
        log: path.join(run, 'recover-device.log')
      })
      device.state = 'Shutdown'
      result.recoveredDevice = true
    }
    if (device.state !== 'Booted') await simctl('boot', device.udid)
    await command('xcrun', ['simctl', 'bootstatus', device.udid, '-b'], { log: path.join(run, 'boot.log') })
    const build = await prepareBuild(session, selected, run, toolchain)
    result = { ...result, sourceHash: build.sourceHash, cacheHit: build.cacheHit }
    session.context.scenario = selected.scenario
    writeContext(session)
    // 每轮 UI 夹具使用新建的本会话合成账本；只卸载清单绑定设备上的本 App。
    // 原生领域探针自行使用随机数据库，不需要重置账本。
    startPhase(run, {
      stage: 'install',
      coverage: [`native-install/${selected.scheme}/${selected.configuration}`],
      log: path.join(run, 'initialize.log')
    })
    const installed = JSON.parse(
      (
        await command('plutil', ['-convert', 'json', '-o', '-', '-'], {
          input: (await simctl('listapps', device.udid)).text
        })
      ).text
    )
    const freshInitialize = needsRepair(
      `native-initialize/${selected.scheme}/${selected.configuration}`,
      toolchain
    )
    if ((selected.scheme === 'DictionaryTouch' || freshInitialize) && installed[APP_ID])
      await simctl('uninstall', device.udid, APP_ID)
    const app = path.join(build.products, `${selected.configuration}-iphonesimulator/App.app`)
    let reuseInstallation = false
    if (
      selected.scheme === 'App' &&
      installed[APP_ID] &&
      !freshInitialize &&
      !needsRepair(`native-install/${selected.scheme}/${selected.configuration}`, toolchain)
    ) {
      const bundle = (await simctl('get_app_container', device.udid, APP_ID, 'app')).text.trim()
      reuseInstallation = hashPaths(bundle, ['.']) === hashPaths(app, ['.'])
    }
    if (!reuseInstallation) await simctl('install', device.udid, app)
    if (selected.scheme === 'DictionaryTouch')
      await simctl(
        'install',
        device.udid,
        path.join(build.products, 'Release-iphonesimulator/DictionaryUITests-Runner.app')
      )
    const container = (await simctl('get_app_container', device.udid, APP_ID, 'data')).text.trim()
    const fixture = path.join(run, 'fixture.json')
    const initialized =
      reuseInstallation && fs.existsSync(path.join(container, 'Library/OfflineLedger/ledgerSQLite.db'))
    result.installationReused = reuseInstallation
    console.log(
      reuseInstallation
        ? 'INSTALL_CACHE_HIT：已安装 App 与当前产物逐字节一致。'
        : 'INSTALL_CACHE_MISS：安装本轮 App。'
    )
    startPhase(run, {
      stage: 'initialize',
      coverage: [`native-initialize/${selected.scheme}/${selected.configuration}`],
      log: path.join(run, 'initialize.log')
    })
    if (!initialized) await simctl('launch', device.udid, APP_ID)
    await command(
      'python3',
      ['scripts/fixtures/dictionary-touch.py', 'wait-initialized', container, device.udid, fixture],
      { log: path.join(run, 'initialize.log') }
    )
    await stopApp(device.udid, path.join(run, 'stop-initialize.log'))
    if (selected.fixture)
      await command(
        'python3',
        [
          'scripts/fixtures/dictionary-touch.py',
          'debug-' + selected.fixture,
          container,
          device.udid,
          fixture
        ],
        { log: path.join(run, 'fixture.log') }
      )
    // 与完整入口一致：夹具完成后由 XCUITest 启动并建立 App 自动化会话。
    const testLog = path.join(run, 'test.log')
    await tracked(
      run,
      'test',
      selectedCoverage(selected),
      'xcodebuild',
      [
        'test-without-building',
        '-xctestrun',
        build.plan,
        '-destination',
        `platform=iOS Simulator,id=${device.udid}`,
        '-parallel-testing-enabled',
        'NO',
        '-test-timeouts-enabled',
        'YES',
        '-maximum-test-execution-time-allowance',
        '60',
        '-collect-test-diagnostics',
        'never',
        ...selected.cases.map((name) => '-only-testing:' + name),
        '-resultBundlePath',
        path.join(run, 'test.xcresult')
      ],
      { log: testLog, timeout: 900_000, scenario: selected.scenario }
    )
    const output = fs.readFileSync(testLog, 'utf8')
    for (const id of selected.cases)
      if (!output.includes(` ${id.split('/').at(-1)}]' passed`))
        throw new Error(`未观察到目标用例通过：${id}`)
    if (selected.scenario && !output.includes('NATIVE_DICTIONARY_SCENARIO_VERIFIED ' + selected.scenario))
      throw new Error('未观察到所选原生场景的完成信号。')
    if (
      !output.includes(
        `Executed ${selected.cases.length} test${selected.cases.length === 1 ? '' : 's'}, with 0 failures`
      )
    )
      throw new Error('实际执行数量不符。')
    if (sourceHash(root, toolchain) !== build.sourceHash)
      throw new Error('测试期间源码发生变化，结果不可作为当前版本通过。')
    startPhase(run, {
      stage: 'check',
      coverage: [`native-readback/${selected.scheme}/${selected.configuration}`],
      log: path.join(run, 'readback.log')
    })
    await stopApp(device.udid, path.join(run, 'stop-final.log'))
    if (selected.fixture)
      await command(
        'python3',
        [
          'scripts/fixtures/dictionary-touch.py',
          'debug-check-' + selected.fixture,
          (await simctl('get_app_container', device.udid, APP_ID, 'data')).text.trim(),
          device.udid,
          fixture
        ],
        { log: path.join(run, 'readback.log') }
      )
    if (verificationHash(root, toolchain) !== result.verificationHash)
      throw new Error('执行器、夹具或测试输入变化，局部结果不能用于当前版本完整验收。')
    const successful = finishPhases(run)
      .flatMap((p) => p.coverage)
      .filter(
        (k) =>
          !(reuseInstallation && k.startsWith('native-install/')) &&
          !(initialized && k.startsWith('native-initialize/'))
      )
    result.coverage = [
      ...new Set([
        ...selectedCoverage(selected),
        `native-startup/${selected.scheme}/${selected.configuration}`,
        ...successful
      ])
    ]
    result.status = 'passed'
    console.log(`局部验证通过（${selected.cases.length} 项，不能替代完整验收）；保留本轮模拟器供下一次调试。`)
  } catch (error) {
    result.error = error.message
    result.cancelled = Boolean(interrupted)
    result.failure = failureDetails({ run, root }, phaseObserver?.failedCases)
    throw error
  } finally {
    result.completedAt = Date.now()
    result.elapsedMs = Date.now() - started
    result.timings = finishPhases(run, result.status === 'passed' ? undefined : new Error(result.error))
    phaseObserver = undefined
    fs.rmSync(path.join(run, 'active.json'), { force: true })
    writeJson(path.join(run, 'result.json'), result)
    recordLocal(root, run, result)
    if (result.status === 'passed') console.log(`EVIDENCE=${run}`)
  }
}

async function main(args) {
  const full = ['common', 'ios-build', 'ios-smoke', 'ios-touch']
  if (!args.length) args = ['common']
  if (args[0] !== 'debug') {
    const guarded = ['ios-smoke', 'ios-touch'].includes(args[0])
    const options = {}
    const evidencePaths = []
    if (!full.includes(args[0]) || (!guarded && args.length !== 1))
      throw new Error(
        '用法：common|ios-build；ios-smoke|ios-touch --from RUN_DIRECTORY [--from OTHER_RUN] [--session PATH]；debug list|create|run|suspend|close'
      )
    for (let i = 1; i < args.length; i += 2) {
      if (
        !['--session', '--from'].includes(args[i]) ||
        !args[i + 1] ||
        (args[i] !== '--from' && Object.hasOwn(options, args[i]))
      )
        throw new Error('完整验收参数无效；拒绝局部过滤、重复会话参数和强制绕过。')
      if (args[i] === '--from') evidencePaths.push(args[i + 1])
      else options[args[i]] = args[i + 1]
    }
    if (guarded && !evidencePaths.length)
      throw new Error('完整验收前必须先通过局部验证，并用 --from RUN_DIRECTORY 指定成功证据。')
    const session = options['--session'] ? readSession(temporary, options['--session']) : undefined
    const scriptPath = path.join(root, 'scripts/lib/ios-app-full.sh')
    const script = fs.readFileSync(scriptPath, 'utf8')
    // Shell 会逐段读取脚本；用校验后的不可变输入，避免运行中编辑文件造成偏移/解析错误。
    await command('bash', ['-n'], { input: script })
    const toolchain = guarded ? await nativeToolchain() : undefined
    const fingerprint = guarded ? verificationHash(root, toolchain) : undefined
    const evidence = guarded ? requireEvidenceSet(root, evidencePaths, inputHash(root), toolchain) : undefined
    const attempt = guarded
      ? beginFull(root, args[0], evidence, fingerprint, process.pid, {
          inputHash: inputHash(root),
          environment: toolchain
        })
      : {
          mode: args[0],
          scope: 'engineering',
          ownerPid: process.pid,
          startedAt: Date.now(),
          run: fs.mkdtempSync(path.join(temporary, 'ios-command-'))
        }
    if (!guarded) writeJson(path.join(attempt.run, 'active.json'), { mode: args[0], ownerPid: process.pid })
    const observer = observeFull({ ...attempt, root, evidenceRoot: temporary })
    // 设备可借用，验收范围与资源生成不能借用局部结果；子流程再次核对真实设备后才重置 App。
    try {
      if (guarded) console.log(`完整验收记录：${attempt.run}`)
      await command('bash', ['-s', '--', args[0]], {
        timeout: guarded ? 900_000 : 2_400_000,
        inherit: true,
        input: script,
        observer,
        env: {
          ...process.env,
          MYBILL_FULL_SESSION: session?.directory ?? '',
          MYBILL_FULL_ATTEMPT: attempt.run
        }
      })
      if (fs.readFileSync(scriptPath, 'utf8') !== script)
        throw new Error('完整流程脚本在执行期间变化；快照已执行，但不能认定当前脚本通过。')
      if (guarded && verificationHash(root, toolchain) !== fingerprint)
        throw new Error('完整验收期间源码、测试或执行器变化，不能认定当前版本通过。')
      if (guarded) finishFull(root, attempt)
    } catch (error) {
      if (guarded) finishFull(root, attempt, error, observer.failedCases)
      else attempt.error = error.message
      throw error
    } finally {
      if (!guarded) {
        const error = attempt.error ? new Error(attempt.error) : undefined
        writeJson(path.join(attempt.run, 'result.json'), {
          ...attempt,
          status: error ? 'failed' : 'passed',
          finishedAt: Date.now(),
          failure: error ? failureDetails({ ...attempt, root }, observer.failedCases) : undefined,
          timings: finishPhases(attempt.run, error)
        })
        fs.rmSync(path.join(attempt.run, 'active.json'), { force: true })
      }
    }
    return
  }
  if (args[1] === 'list' && args.length === 2) {
    console.log(
      [
        ...nativeCases.map((x) => `--case NativeTests/NativeSqliteTests/${x}`),
        ...uiCases.map((x) => `--case DictionaryUITests/DictionaryTouchTests/${x}`),
        ...[...scenarios, ...Object.keys(uiScenarios), ...recoveryScenarios].map((x) => `--scenario ${x}`),
        ...checkNames.map((x) => `check --check ${x}`)
      ].join('\n')
    )
    return
  }
  if (args[1] === 'check') return runCheck(args)
  if (!['create', 'run', 'suspend', 'close'].includes(args[1])) throw new Error('未知 debug 操作。')
  if (process.platform !== 'darwin') throw new Error('原生调试需要 macOS。')
  const managing = ['suspend', 'close'].includes(args[1])
  if (managing) await selectDeveloperTools()
  const toolchain = managing ? '' : await nativeToolchain()
  if (args[1] === 'create') {
    if (args.length !== 2) throw new Error('create 不接受已有设备或会话参数。')
    const directory = fs.mkdtempSync(path.join(temporary, 'ios-debug-'))
    const runId = randomUUID()
    const context = {
      kind: 'ios-debug',
      schema: 1,
      state: 'open',
      runId,
      appId: APP_ID,
      name: `我的账单调试-${runId}`
    }
    // 创建失败/取消也有归属线索；补偿只允许本命令随机名称与型号完全匹配的设备。
    const pending = path.join(directory, 'creating.json')
    fs.writeFileSync(pending, JSON.stringify(context), { mode: 0o600 })
    try {
      context.simulatorId = (await simctl('create', context.name, DEVICE_TYPE, RUNTIME)).text.trim()
      writeContext({ file: path.join(directory, 'test-context.json'), context })
      fs.unlinkSync(pending)
    } catch (error) {
      const signal = interrupted
      interrupted = undefined
      try {
        const devices = Object.values((await inventory()).devices)
          .flat()
          .filter((d) => d.name === context.name && d.deviceTypeIdentifier === DEVICE_TYPE)
        if (devices.length > 1) throw new Error('创建补偿发现归属不唯一，未删除设备')
        for (const device of devices) await simctl('delete', device.udid)
      } catch (cleanupError) {
        throw new Error(`${error.message}；创建补偿失败：${cleanupError.message}，归属清单：${pending}`)
      } finally {
        interrupted = signal
      }
      throw error
    }
    console.log(
      `SESSION=${directory}\nSIMULATOR=${context.simulatorId}\n结束本轮调试后执行 debug close --session 上述路径。`
    )
    return
  }
  if (
    args[2] !== '--session' ||
    !args[3] ||
    (managing ? args.length !== 4 : args.length !== 6 || !['--case', '--scenario'].includes(args[4]))
  ) {
    throw new Error(
      '用法：debug run --session PATH --case ID|--scenario NAME；debug suspend|close --session PATH'
    )
  }
  const selected = args[1] === 'run' ? selection(args[4], args[5], scenarios) : undefined
  const session = readSession(temporary, args[3], args[1] === 'close')
  if (args[1] === 'suspend') {
    const device = assertDevice(session.context, await inventory())
    if (device.state !== 'Shutdown') await simctl('shutdown', device.udid)
    console.log('本轮调试设备已关闭运行，保留会话和缓存；run 恢复同一设备，最终 close 清理。')
    return
  }
  if (args[1] === 'close') {
    if (session.context.state === 'closed') {
      console.log('会话已关闭。')
      return
    }
    const devices = await inventory()
    const exists = Object.values(devices.devices)
      .flat()
      .some((d) => d.udid === session.context.simulatorId)
    if (exists) {
      const device = assertDevice(session.context, devices)
      if (device.state !== 'Shutdown') await simctl('shutdown', device.udid)
      await simctl('delete', device.udid)
    }
    session.context.state = 'closed'
    delete session.context.scenario
    writeContext(session)
    // 缓存只属于本会话，关闭时回收；日志和 xcresult 按证据生命周期保留。
    fs.rmSync(path.join(session.directory, 'DerivedData'), { recursive: true, force: true })
    console.log('本轮调试设备和构建缓存已清理，证据保留。')
    return
  }
  await runPartial(session, selected, toolchain, { kind: args[4].slice(2), name: args[5] })
}

fs.mkdirSync(temporary, { recursive: true })
const lock = path.join(temporary, 'ios-command.lock')
let locked = false
try {
  try {
    fs.mkdirSync(lock)
    locked = true
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    throw new Error(`已有原生命令或遗留锁：${lock}；先核对其中 owner.json 的进程，不自动接管。`)
  }
  fs.writeFileSync(
    path.join(lock, 'owner.json'),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    { mode: 0o600 }
  )
  await main(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted ? 143 : 1
} finally {
  if (locked) fs.rmSync(lock, { recursive: true })
}
