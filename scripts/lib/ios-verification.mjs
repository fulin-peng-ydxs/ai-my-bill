import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { release } from 'node:os'
import { performance } from 'node:perf_hooks'
import { readSession, sourceHash, hashPaths, selection } from './ios-debug.mjs'
import { checkDefinition, scriptTestFiles } from './ios-checks.mjs'
import { assertScriptReport } from './ios-test-reports.mjs'

export const controlInputs = [
  'scripts/ios-app.sh',
  'scripts/ios-app.mjs',
  'scripts/ios-capacity-report.mjs',
  'scripts/lib',
  'scripts/fixtures/dictionary-touch.py',
  'scripts/fixtures/ios-ui-baseline.py',
  'scripts/fixtures/ios_data_management.py',
  'scripts/tests/ios-cache.test.mjs',
  'scripts/verify-ios-resources.mjs',
  'scripts/ios-storage-policy.mjs',
  'scripts/tests/ios-debug.test.mjs',
  'scripts/tests/ios-verification.test.mjs',
  'scripts/tests/ios-resources.test.mjs',
  'scripts/tests/ios-ci.test.mjs',
  'scripts/ios-ci.mjs',
  'scripts/ios-ci.sh',
  'config/ios-ci.json',
  'scripts/toolchain.sh',
  'package.json',
  '.nvmrc'
]
export const budgets = {
  build: 600_000,
  install: 120_000,
  boot: 120_000,
  initialize: 60_000,
  check: 300_000,
  startup: 180_000,
  testCase: 60_000,
  interruption: 120_000
}
export const totalBudgets = { acceptance: 900_000, touch: 2_400_000, engineering: 2_400_000 }

/** 完整触摸覆盖字典及 T6—T11，不能沿用单场景预算；阶段、单用例和失败锁仍独立生效。 */
export function totalBudgetFor(mode) {
  if (mode === 'ios-touch') return totalBudgets.touch
  return ['common', 'ios-build'].includes(mode) ? totalBudgets.engineering : totalBudgets.acceptance
}

/** 单调时钟从入口累计；子命令只能消费剩余预算，不能重新获得一整轮时间。 */
export function createDeadline(budgetMs, { now = () => performance.now() } = {}) {
  const started = now()
  const snapshot = () => ({ budgetMs, elapsedMs: Math.max(0, now() - started) })
  return {
    snapshot,
    remaining() {
      const remaining = budgetMs - snapshot().elapsedMs
      if (remaining <= 0) throw new Error('整轮执行超时（包含工具链前置检查），停止并保留证据。')
      return Math.ceil(remaining)
    }
  }
}
const digest = (text) => createHash('sha256').update(text).digest('hex')
const cacheRepairKey = (inputs, environment, key) => digest(inputs + '\0' + environment + '\0' + key)
const cachedPhase = (key) => /^(native-build|native-install|native-initialize)\//.test(key)
export const evidenceRoot = (root) => path.join(root, '.local/ios/tmp/ai-agent')
const stateFile = (root) => path.join(evidenceRoot(root), 'ios-verification-state.json')
export const inputHash = (root) =>
  digest(
    sourceHash(root, [process.version, process.platform, process.arch, release()].join('/')) +
      hashPaths(root, [...new Set([...controlInputs, ...scriptTestFiles(root)])])
  )
export const verificationHash = (root, environment) => digest(inputHash(root) + '\0' + environment)
export function writeJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, file)
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
export const caseKey = (id) => 'case/' + id
export const scenarioKey = (name) =>
  'scenario/NativeTests/NativeSqliteTests/testOfflineDictionaryScenario/' + name
export function selectedCoverage(selected) {
  if (selected.recoveryPhases) return selected.recoveryPhases.map((p) => 'recovery/' + p)
  return [...selected.cases.map(caseKey), ...(selected.scenario ? [scenarioKey(selected.scenario)] : [])]
}
export const recoveryKeys = ['snapshot-ready', 'migration-recorded', 'upgrade-committed'].map(
  (p) => 'recovery/' + p
)

/** v1 的最近记录和仍在保留的逐轮回执一起迁移，不把已有失败次数清零。 */
export function readState(root) {
  if (!fs.existsSync(stateFile(root)))
    return { schema: 2, attempts: {}, history: [], localFailures: {}, cacheRepairs: {} }
  const state = readJson(stateFile(root))
  if (state.schema === 2 && Array.isArray(state.history) && state.attempts && state.localFailures)
    return { ...state, cacheRepairs: state.cacheRepairs ?? {} }
  if (state.schema !== 1 || !state.attempts || Array.isArray(state.attempts))
    throw new Error('完整验收状态损坏，先排查，不自动清空。')
  const records = new Map()
  for (const name of fs.readdirSync(evidenceRoot(root)).filter((n) => /^ios-full-[A-Za-z0-9]+$/.test(n))) {
    const file = path.join(evidenceRoot(root), name, 'result.json')
    if (fs.existsSync(file) && fs.lstatSync(file).isFile()) {
      const value = readJson(file)
      if (['ios-smoke', 'ios-touch'].includes(value.mode) && value.fingerprint && value.run)
        records.set(value.run, value)
    }
  }
  for (const value of Object.values(state.attempts))
    if (!records.has(value.run)) records.set(value.run, value)
  return {
    schema: 2,
    attempts: state.attempts,
    history: [...records.values()].sort((a, b) => a.startedAt - b.startedAt),
    localFailures: {},
    cacheRepairs: {}
  }
}
const covers = (coverage, required) => required.every((key) => coverage.includes(key))
function relevant(mode, keys) {
  return keys.some(
    (key) =>
      key.startsWith('check/') ||
      key.startsWith('app-test/') ||
      key.startsWith('native-') ||
      (mode === 'ios-smoke'
        ? key.startsWith('recovery/') ||
          key.startsWith('scenario/NativeTests/') ||
          key.startsWith('case/NativeTests/')
        : key.startsWith('case/DictionaryUITests/'))
  )
}

/** 每个模式在当前输入的最后结论优先于该模式在其他输入的最新记录。 */
function currentAttempts(state, fingerprint) {
  const attempts = new Map()
  for (const attempt of state.history) {
    if (attempt.fingerprint === fingerprint) attempts.set(attempt.mode, attempt)
  }
  return attempts
}

/** 非 XCTest 失败按已注册阶段处理；恢复用例按稳定的阶段键处理，不要求单跑中断半流程。 */
export function failureDetails(attempt, failedCases = []) {
  const progress = path.join(attempt.run, 'progress.json')
  const phase = fs.existsSync(progress) ? readJson(progress) : undefined
  if (phase?.coverage?.some((k) => k.startsWith('recovery/')))
    return { stage: phase.stage, required: phase.coverage }
  if (phase?.stage === 'test' && phase.scenario)
    return { stage: 'test', required: [scenarioKey(phase.scenario)] }
  const observedFile = path.join(attempt.run, 'observation.json')
  if (!failedCases.length && phase?.stage === 'test' && fs.existsSync(observedFile)) {
    const observed = readJson(observedFile)
    if (observed.phaseStartedAt === phase.startedAt && observed.phaseLog === phase.log)
      failedCases = observed.failedCases?.length
        ? observed.failedCases
        : observed.active
          ? [observed.active.id]
          : []
  }
  const legacyRecovery =
    phase?.log &&
    path
      .basename(phase.log)
      .match(/^(?:recovery|interruption)-(snapshot-ready|migration-recorded|upgrade-committed)/)
  if (legacyRecovery) return { stage: 'test', required: ['recovery/' + legacyRecovery[1]] }
  if (failedCases.length)
    return {
      stage: 'test',
      required: failedCases.flatMap((id) =>
        id.endsWith('/testRecoverProcessInterruption') || id.endsWith('/testPrepareProcessInterruption')
          ? recoveryKeys
          : [caseKey(id)]
      )
    }
  if (phase?.report && phase.coverage?.includes('check/app-tests')) {
    const report = readVitest(phase.report, attempt.root)
    if (report.failed.length) return { stage: 'check', required: report.failed }
  }
  if (phase?.coverage?.length) return { stage: phase.stage ?? 'test', required: phase.coverage }
  // 兼容 v1 恢复阶段日志；中断的运行也可从最近日志重建所需局部目标。
  if (phase?.log) {
    const match = path
      .basename(phase.log)
      .match(/^(?:recovery|interruption)-(snapshot-ready|migration-recorded|upgrade-committed)/)
    if (match) return { stage: 'test', required: ['recovery/' + match[1]] }
  }
  return { stage: 'launcher', required: ['check/script-tests'] }
}
export function readVitest(file, root) {
  if (!fs.existsSync(file)) return { passed: [], failed: [] }
  const result = readJson(file),
    passed = [],
    failed = []
  for (const suite of result.testResults ?? [])
    for (const test of suite.assertionResults ?? []) {
      const key =
        'app-test/' +
        path.relative(path.join(root, 'app'), suite.name).split(path.sep).join('/') +
        '#' +
        test.fullName
      if (test.status === 'passed') passed.push(key)
      if (test.status === 'failed') failed.push(key)
    }
  if (
    !failed.length &&
    (result.numFailedTestSuites > 0 || (result.testResults ?? []).some((s) => s.status === 'failed'))
  )
    failed.push('check/app-tests')
  return { passed, failed }
}
export function recordLocal(root, run, result) {
  const state = readState(root)
  if (result.status !== 'passed' && !result.cancelled && result.failure?.observed !== false) {
    const failure = result.failure ?? { required: result.coverage ?? ['check/script-tests'] }
    const key = digest(
      result.inputHash + '\0' + (result.environment ?? '') + '\0' + failure.required.join('\0')
    )
    state.localFailures[key] = {
      run,
      completedAt: result.completedAt,
      inputHash: result.inputHash,
      environment: result.environment,
      required: failure.required
    }
  }
  if (result.status === 'passed') {
    // 缓存修复是逐阶段、逐输入的事实；不把完整失败/未完成记录改为通过。
    if (result.scope === 'partial' && result.environment) {
      for (const key of result.coverage.filter(cachedPhase)) {
        const identity = cacheRepairKey(result.inputHash, result.environment, key)
        if (state.cacheRepairs[identity]?.completedAt >= result.completedAt) continue
        state.cacheRepairs[identity] = {
          run,
          inputHash: result.inputHash,
          environment: result.environment,
          completedAt: result.completedAt
        }
      }
    }
    for (const failure of Object.values(state.localFailures)) {
      if (
        failure.inputHash === result.inputHash &&
        (!failure.environment || failure.environment === result.environment) &&
        result.completedAt > failure.completedAt &&
        covers(result.coverage, failure.required)
      )
        failure.repairedAt = result.completedAt
    }
  }
  writeJson(stateFile(root), state)
}

/** 失败阶段必须重做；成功修复后恢复缓存，不把旧输入故障永久变成缓存禁用。 */
export function needsPhaseRepair(root, key, environment) {
  const state = readState(root)
  const inputs = inputHash(root)
  const current = currentAttempts(state, digest(inputs + '\0' + environment))
  const repaired = state.cacheRepairs[cacheRepairKey(inputs, environment, key)]
  const repairedAfter = (time) => repaired?.completedAt > time
  const pendingFull = Object.entries(state.attempts)
    .map(([mode, attempt]) => current.get(mode) ?? attempt)
    .some(
      (a) =>
        a.status !== 'passed' &&
        (a.failure ?? failureDetails({ ...a, root }, a.failedCases)).required.includes(key) &&
        !repairedAfter(a.finishedAt ?? a.startedAt)
    )
  if (pendingFull) return true
  return Object.values(state.localFailures).some(
    (f) =>
      !f.repairedAt &&
      !repairedAfter(f.completedAt) &&
      f.inputHash === inputs &&
      (!environment || !f.environment || f.environment === environment) &&
      f.required.includes(key)
  )
}

/** 校验本工作区的实际局部回执；Node 局部不绑定 Xcode，原生局部须匹配运行环境。 */
export function requireEvidence(root, input, currentInput, environment) {
  if (!input) throw new Error('完整验收前必须先通过局部验证，并用 --from RUN_DIRECTORY 指定成功证据。')
  const run = path.resolve(input),
    base = fs.realpathSync(evidenceRoot(root))
  if (fs.realpathSync(run) !== run) throw new Error('拒绝非受管局部证据路径。')
  let session
  if (path.dirname(run) === base && /^ios-check-[A-Za-z0-9]+$/.test(path.basename(run))) {
    /* 无需启动模拟器的局部检查 */
  } else {
    session = readSession(base, path.dirname(run), true)
    if (!/^run-[A-Za-z0-9]+$/.test(path.basename(run))) throw new Error('拒绝非受管局部证据路径。')
  }
  const file = path.join(run, 'result.json')
  if (!fs.lstatSync(file).isFile()) throw new Error('局部回执必须是普通文件。')
  const result = readJson(file)
  if (
    result.scope !== 'partial' ||
    result.status !== 'passed' ||
    result.inputHash !== currentInput ||
    (result.environment && result.environment !== environment) ||
    !result.coverage?.length ||
    !Number.isSafeInteger(result.completedAt) ||
    result.completedAt > Date.now()
  )
    throw new Error('局部证据失败、过期、版本不符或环境不符。')
  if (session) {
    if (result.runId !== session.context.runId || result.simulatorId !== session.context.simulatorId)
      throw new Error('局部证据设备归属不符。')
    const selected = selection(
      '--' + result.requested?.kind,
      result.requested?.name,
      readJson(path.join(root, 'app/native-tests/scenarios.json'))
    )
    if (JSON.stringify(selected.cases) !== JSON.stringify(result.executedCases))
      throw new Error('局部证据范围不符。')
    const allowed = [
      ...selectedCoverage(selected),
      'native-boot',
      'check/app-build',
      'check/probe-build',
      'check/resources/source',
      `native-install/${selected.scheme}/${selected.configuration}/app`,
      ...(selected.scheme === 'DictionaryTouch'
        ? [`native-install/${selected.scheme}/${selected.configuration}/runner`] : []),
      ...['native-build', 'native-install', 'native-initialize', 'native-startup', 'native-readback'].map(
        (k) => `${k}/${selected.scheme}/${selected.configuration}`
      )
    ]
    if (!result.coverage.every((key) => allowed.includes(key)))
      throw new Error('局部原生证据包含未执行范围。')
    const log = fs.readFileSync(path.join(run, 'test.log'), 'utf8')
    if (selected.recoveryPhases) {
      for (const p of selected.recoveryPhases)
        if (
          !log.includes('LEDGER_PROCESS_INTERRUPTION_RECOVERED ' + p) ||
          !result.coverage.includes('recovery/' + p)
        )
          throw new Error('成对恢复证据缺少阶段完成信号。')
    } else {
      for (const id of selected.cases)
        if (!log.includes(` ${id.split('/').at(-1)}]' passed`) || !result.coverage.includes(caseKey(id)))
          throw new Error('缺少实际目标通过记录。')
      if (
        selected.scenario &&
        (!result.coverage.includes(scenarioKey(selected.scenario)) ||
          !log.includes('NATIVE_DICTIONARY_SCENARIO_VERIFIED ' + selected.scenario))
      )
        throw new Error('缺少实际场景通过记录。')
      if (
        !log.includes(
          `Executed ${selected.cases.length} test${selected.cases.length === 1 ? '' : 's'}, with 0 failures`
        )
      )
        throw new Error('实际执行数量不符。')
    }
  } else {
    const definition = checkDefinition(root, run, result.check, result.options)
    if (
      result.command?.exit !== 0 ||
      result.command.program !== path.basename(definition.program) ||
      JSON.stringify(result.command.args) !== JSON.stringify(definition.args)
    )
      throw new Error('局部检查命令回执不符。')
    if (
      result.check !== 'app-tests' &&
      JSON.stringify(result.coverage) !== JSON.stringify(definition.coverage)
    )
      throw new Error('局部检查证据层次不符。')
    if (result.check === 'script-tests')
      assertScriptReport(root, fs.readFileSync(path.join(run, 'check.log'), 'utf8'), process.platform)
    if (result.check === 'app-tests') {
      const parsed = readVitest(path.join(run, 'vitest.json'), root)
      if (
        !parsed.passed.length ||
        parsed.failed.length ||
        !parsed.passed.every((key) => result.coverage.includes(key))
      )
        throw new Error('局部 Vitest 没有实际命中/通过目标。')
      const expected = [
        ...parsed.passed,
        ...(result.options?.file || result.options?.name ? [] : ['check/app-tests'])
      ]
      if (JSON.stringify(result.coverage) !== JSON.stringify(expected))
        throw new Error('局部 Vitest 覆盖范围不符。')
    }
  }
  return { run, result }
}

/** 每份回执独立验证；覆盖可合并，但旧输入、旧环境与未命中不能混入。 */
export function requireEvidenceSet(root, inputs, currentInput, environment) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 32) {
    throw new Error('完整验收需要 1 至 32 份 --from 局部成功证据。')
  }
  const evidence = inputs.map((input) => requireEvidence(root, input, currentInput, environment))
  if (new Set(evidence.map((item) => item.run)).size !== evidence.length) {
    throw new Error('重复的 --from 回执不能增加覆盖范围。')
  }
  return evidence
}

/** 历史按 mode+fingerprint+故障事件计数；A→B→A 不重置 A 的预算。 */
export function beginFull(root, mode, evidence, fingerprint, ownerPid, context = {}) {
  const proofs = Array.isArray(evidence) ? evidence : [evidence]
  if (!proofs.length) throw new Error('完整验收缺少局部成功证据。')
  const state = readState(root)
  const same = state.history.filter((attempt) => attempt.mode === mode && attempt.fingerprint === fingerprint)
  const current = currentAttempts(state, fingerprint)
  const currentPending = current.get(mode)?.status !== 'passed' ? current.get(mode) : undefined
  const currentOtherPending = [...current.values()]
    .filter((attempt) => attempt.status !== 'passed')
    .sort((a, b) => b.startedAt - a.startedAt)[0]
  // 修复新输入可继续正常开发；切回旧输入时，旧输入自己的失败仍须修复。
  const otherInputPending = Object.values(state.attempts)
    .filter((attempt) => attempt.status !== 'passed' && current.get(attempt.mode)?.status !== 'passed')
    .sort((a, b) => b.startedAt - a.startedAt)[0]
  const pending = currentPending ?? currentOtherPending ?? otherInputPending
  const passed = same.filter((attempt) => attempt.status === 'passed').at(-1)
  const inputs = context.inputHash ?? proofs[0].result.inputHash
  const environment = context.environment ?? proofs[0].result.environment
  const requirements = new Map()
  let incident = 'initial'
  const need = (keys, after) => {
    for (const key of keys) requirements.set(key, Math.max(requirements.get(key) ?? 0, after))
  }
  if (pending) {
    if (pending.mode !== mode) {
      throw new Error(`先处理 ${pending.mode} 的未完成/失败验收，不能转跑另一套完整验收。`)
    }
    need(
      (pending.failure ?? failureDetails({ ...pending, root }, pending.failedCases)).required,
      pending.finishedAt ?? pending.startedAt
    )
    if (pending.fingerprint === fingerprint) incident = pending.incident ?? 'initial'
  }
  // 首次完整检查也不能忽略已发现的局部故障；完整失败后暴露的新故障一并校验。
  const since = pending?.startedAt ?? passed?.finishedAt ?? 0
  const failures = Object.values(state.localFailures)
    .filter(
      (failure) =>
        failure.inputHash === inputs &&
        (!failure.environment || failure.environment === environment) &&
        failure.completedAt > since &&
        relevant(mode, failure.required)
    )
    .sort((a, b) => a.completedAt - b.completedAt)
  if (!pending && passed) {
    if (!failures.length) {
      throw new Error('相同输入完整验收已通过，拒绝重复；需有实际新增局部失败及相关修复证据。')
    }
    incident = 'local:' + failures[0].run
  }
  for (const failure of failures) need(failure.required, failure.completedAt)
  // 每个目标按自己的最近失败时间校验，允许 A 修好后再修 B，无须倒回重跑 A。
  const oldRuns = pending?.evidenceRuns ?? (pending?.evidence ? [pending.evidence] : [])
  const missing = [...requirements].filter(
    ([key, after]) =>
      !proofs.some(
        (proof) =>
          proof.result.coverage.includes(key) &&
          proof.result.completedAt > after &&
          !oldRuns.includes(proof.run)
      )
  )
  if (missing.length) {
    throw new Error(
      `失败后先转相关局部：需要新成功证据覆盖 ${missing.map(([key]) => key).join(', ')}；旧/无关回执拒绝。`
    )
  }
  const prior = same.filter((attempt) => (attempt.incident ?? 'initial') === incident)
  const count = Math.max(prior.length, ...prior.map((attempt) => (attempt.retry ?? 0) + 1), 0)
  if (count >= 2) {
    throw new Error(
      '该输入/故障事件已完成初验及一次复验；再次失败/中断后必须修正相关输入，不能刷局部绿色重置次数。'
    )
  }
  const run = fs.mkdtempSync(path.join(evidenceRoot(root), 'ios-full-'))
  const attempt = {
    mode,
    status: 'running',
    startedAt: Date.now(),
    ownerPid,
    fingerprint,
    inputHash: inputs,
    environment,
    evidence: proofs[0].run,
    evidenceRuns: proofs.map((proof) => proof.run),
    run,
    retry: count,
    incident,
    failedCases: []
  }
  state.attempts[mode] = attempt
  state.history.push(attempt)
  writeJson(stateFile(root), state)
  writeJson(path.join(run, 'result.json'), attempt)
  return attempt
}
export function finishFull(root, attempt, error, failedCases = []) {
  const state = readState(root)
  if (state.attempts[attempt.mode]?.run !== attempt.run) throw new Error('验收状态归属变化，拒绝覆盖。')
  const result = {
    ...attempt,
    status: error ? 'failed' : 'passed',
    finishedAt: Date.now(),
    failedCases,
    failure: error ? failureDetails({ ...attempt, root }, failedCases) : undefined,
    error: error?.message,
    timings: finishPhases(attempt.run, error)
  }
  state.attempts[attempt.mode] = result
  state.history = state.history.map((a) => (a.run === attempt.run ? result : a))
  writeJson(path.join(attempt.run, 'result.json'), result)
  writeJson(stateFile(root), state)
}
export function requireActiveFull(root, mode, run) {
  const attempt = readState(root).attempts[mode]
  const lock = readJson(path.join(evidenceRoot(root), 'ios-command.lock/owner.json'))
  if (!attempt || attempt.status !== 'running' || attempt.run !== run || attempt.ownerPid !== lock.pid)
    throw new Error('内部完整入口缺少有效调度许可。')
  process.kill(attempt.ownerPid, 0)
  return attempt
}
function requireExecution(root, mode, run) {
  if (['common', 'ios-build'].includes(mode)) {
    if (
      path.dirname(run) !== fs.realpathSync(evidenceRoot(root)) ||
      fs.realpathSync(run) !== run ||
      !/^ios-command-[A-Za-z0-9]+$/.test(path.basename(run))
    )
      throw new Error('工程检查路径不合法。')
    const active = readJson(path.join(run, 'active.json'))
    const owner = readJson(path.join(evidenceRoot(root), 'ios-command.lock/owner.json'))
    if (active.mode !== mode || active.ownerPid !== owner.pid) throw new Error('工程检查缺少有效调度许可。')
    process.kill(owner.pid, 0)
    return
  }
  if (mode !== 'ios-recovery') return requireActiveFull(root, mode, run)
  const session = readSession(evidenceRoot(root), path.dirname(run))
  if (fs.realpathSync(run) !== run || !/^run-[A-Za-z0-9]+$/.test(path.basename(run)))
    throw new Error('局部恢复路径不合法。')
  const result = readJson(path.join(run, 'active.json')),
    owner = readJson(path.join(evidenceRoot(root), 'ios-command.lock/owner.json'))
  if (
    result.ownerPid !== owner.pid ||
    result.runId !== session.context.runId ||
    !result.recoveryPhases?.length ||
    !result.recoveryPhases.every((p) => recoveryKeys.includes('recovery/' + p)) ||
    process.env.MYBILL_RECOVERY_PHASES !== result.recoveryPhases.join(',') ||
    process.env.MYBILL_FULL_SESSION !== session.directory
  )
    throw new Error('局部成对恢复缺少活动许可。')
  process.kill(owner.pid, 0)
}

/** 阶段时钟分离；build/install 不消耗测试启动或单用例预算。 */
export function startPhase(run, phase) {
  finishPhases(run)
  writeJson(path.join(run, 'progress.json'), { ...phase, id: randomUUID(), startedAt: Date.now() })
}
export function finishPhases(run, error) {
  const file = path.join(run, 'progress.json'),
    timings = path.join(run, 'timings.json')
  const history = fs.existsSync(timings) ? readJson(timings) : []
  if (fs.existsSync(file)) {
    const phase = readJson(file)
    if (!phase.finishedAt) {
      phase.finishedAt = Date.now()
      phase.elapsedMs = phase.finishedAt - phase.startedAt
      phase.status = error ? 'failed' : 'passed'
      history.push(phase)
      writeJson(file, phase)
      writeJson(timings, history)
    }
  }
  return history
}
export function observeFull(attempt, { now = Date.now, limits = budgets } = {}) {
  let phase,
    offset = 0,
    buffer = '',
    active,
    lastActivity,
    anyStarted = false
  const failedCases = []
  const observation = path.join(attempt.run, 'observation.json')
  const remember = () =>
    writeJson(observation, {
      active,
      failedCases,
      phaseStartedAt: phase.startedAt,
      phaseLog: phase.log,
      required: active ? [caseKey(active.id)] : phase.coverage
    })
  const failCase = (id, reason) => {
    failedCases.push(id)
    remember()
    throw new Error(`正例失败，立即停止并转局部：${id}（${reason}）`)
  }
  return {
    failedCases,
    poll() {
      const file = path.join(attempt.run, 'progress.json')
      if (!fs.existsSync(file)) return
      const next = readJson(file)
      if (
        next.id !== phase?.id ||
        next.startedAt !== phase?.startedAt ||
        next.log !== phase?.log ||
        next.stage !== phase?.stage
      ) {
        phase = next
        offset = 0
        buffer = ''
        active = undefined
        anyStarted = false
        lastActivity = phase.startedAt
      }
      if (next.finishedAt) return
      if (
        !Array.isArray(phase.coverage) ||
        !phase.coverage.length ||
        !Number.isFinite(phase.startedAt) ||
        !['build', 'install', 'boot', 'initialize', 'check', 'test'].includes(phase.stage)
      )
        throw new Error('执行阶段元数据不合法。')
      if (phase.stage !== 'test') {
        if (phase.budgetMs !== undefined &&
          (!Number.isSafeInteger(phase.budgetMs) || phase.budgetMs < 1 || phase.budgetMs > limits[phase.stage]))
          throw new Error('阶段剩余预算不合法。')
        if (now() - phase.startedAt > (phase.budgetMs ?? limits[phase.stage]))
          throw new Error(`${phase.stage} 阶段超时，停止并保留对应局部目标：${phase.coverage.join(', ')}`)
        return
      }
      if (phase.testCaseMs !== undefined &&
          (!Number.isSafeInteger(phase.testCaseMs) || phase.testCaseMs < 1 || phase.testCaseMs > limits.testCase))
        throw new Error('单用例阶段预算不合法。')
      const testCaseMs = phase.testCaseMs ?? limits.testCase
      const boundary = attempt.evidenceRoot ?? path.dirname(attempt.run)
      if (
        !path.isAbsolute(phase.log) ||
        !phase.log.startsWith(boundary + path.sep) ||
        fs.realpathSync(path.dirname(phase.log)) !== path.dirname(phase.log)
      )
        throw new Error('验收进度日志越界。')
      if (fs.existsSync(phase.log)) {
        if (!fs.lstatSync(phase.log).isFile()) throw new Error('验收日志必须是普通文件。')
        const size = fs.statSync(phase.log).size
        if (size > offset) {
          const fd = fs.openSync(phase.log, 'r'),
            data = Buffer.alloc(Math.min(size - offset, 1_048_576))
          try {
            offset += fs.readSync(fd, data, 0, data.length, offset)
          } finally {
            fs.closeSync(fd)
          }
          buffer += data.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop()
          for (const line of lines) {
            const match = line.match(
              /Test Case '-\[([^\.]+)\.([^ ]+) ([^\]]+)\]' (started|passed|failed|exceeded execution time allowance)/
            )
            if (!match) continue
            const id = `${match[1]}/${match[2]}/${match[3]}`
            if (match[4] === 'started') {
              active = { id, startedAt: now() }
              anyStarted = true
              lastActivity = now()
              remember()
            } else if (match[4] === 'passed') {
              active = undefined
              lastActivity = now()
              remember()
            } else if (!phase.expectedFailure) failCase(id, match[4])
          }
          if (buffer.length > 1_048_576) throw new Error('验收日志单行超限。')
        }
      }
      if (phase.expectedFailure) {
        if (now() - phase.startedAt > limits.interruption)
          throw new Error('主动中断准备阶段超时，先执行同阶段成对局部恢复。')
      } else if (active && now() - active.startedAt > testCaseMs) failCase(active.id, `单用例 ${testCaseMs / 1000} 秒预算`)
      else if (!active && now() - lastActivity > limits.startup)
        throw new Error(
          anyStarted ? '测试会话结束/用例交接超时。' : '测试启动阶段超时；构建和安装时间不计入该阶段。'
        )
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, mode, run, stage, coverage, log, report, expectedFailure] = process.argv.slice(2)
    requireExecution(process.cwd(), mode, run)
    if (action === 'phase')
      startPhase(run, {
        stage,
        coverage: coverage.split(','),
        log,
        report: report || undefined,
        expectedFailure: expectedFailure === 'yes'
      })
    else if (action !== 'permit') throw new Error('未知内部操作。')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
