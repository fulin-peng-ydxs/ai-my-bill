import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { measurementHost } from './ios-evidence-inputs.mjs'
import { suiteMeasurement } from './ios-execution-inputs.mjs'
import { assertMeasurement, partialSeal } from './ios-local-measurement.mjs'
export { partialSeal, finishPartialMeasurement } from './ios-local-measurement.mjs'
export { partialMeasurement, registerPartial } from './ios-capacity-registration.mjs'
import { selection, readSession } from './ios-debug.mjs'
import { assertUiReadback, assertUiInteractionLog } from './ios-ui-readback.mjs'
import { readEvidenceResult, readState, evidenceRoot, inputHash } from './ios-verification.mjs'
import { equivalentCaseInputs } from './ios-equivalent-evidence.mjs'
import { validateCapacityPartial } from './ios-capacity-evidence.mjs'
import { assertEvidenceTerminal } from './ios-evidence-terminal.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const read = file => {
  if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) throw new Error('局部测量必须为受管普通文件。')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** The durable terminal record wins over a missing, truncated or altered result file. */
function failedAttempt(row, result) {
  const { measurement: m } = row
  const required = row.recordedRequired ?? result?.failure?.required
  const validTime = time => Number.isSafeInteger(time) && time > 0 && time <= Date.now()
  const time = [row.recordedAt, result?.completedAt, m.startedAt].find(validTime)
  return { required, time }
}

export function partialRuns(root) {
  const base = evidenceRoot(root), rows = new Map(), errors = [], state = readState(root)
  const registered = state.localAttempts ?? {}
  const route = relative => {
    if (!/^\.local\/ios\/tmp\/ai-agent\/ios-debug-[A-Za-z0-9]+\/run-[A-Za-z0-9]+$/.test(relative))
      throw new Error('局部任务登记路径无效。')
    return path.join(root, relative)
  }
  for (const [relative, attempt] of Object.entries(registered)) {
    const run = route(relative)
    assertMeasurement(attempt.measurement)
    rows.set(run, { run, measurement: attempt.measurement, registered: true,
      recordedAt: attempt.completedAt, recordedRequired: attempt.required,
      recordedStatus: attempt.status, recordedCancelled: attempt.cancelled })
  }
  if (fs.existsSync(base)) for (const name of fs.readdirSync(base).filter(n => /^ios-debug-[A-Za-z0-9]+$/.test(n))) {
    const directory = path.join(base, name)
    if (fs.realpathSync(directory) !== directory || !fs.lstatSync(directory).isDirectory()) continue
    for (const runName of fs.readdirSync(directory).filter(n => /^run-[A-Za-z0-9]+$/.test(n))) {
      const run = path.join(directory, runName), file = path.join(run, 'local-measurement.json')
      // Capacity has its own authoritative pre-execution route, never an App/UI success.
      if (Object.hasOwn(state.capacityAttempts ?? {},path.relative(root,run)) && !rows.has(run)) continue
      if (!fs.existsSync(file) && !rows.has(run)) continue
      try {
        if (fs.realpathSync(run) !== run) throw new Error('局部证据目录不能经符号链接。')
        readSession(base, directory, true)
        const measurement = read(file), registeredRow = rows.get(run), prior = registeredRow?.measurement
        assertMeasurement(measurement)
        const core = m => { const { baseline, ...body } = m; return body }
        if (prior && hash(core(prior)) !== hash(core(measurement))) throw new Error('局部路由与执行前登记不符。')
        rows.set(run, { ...registeredRow, run, measurement, registered: Boolean(prior) })
      } catch (error) {
        errors.push({ run, error: error.message })
        // A bad unrelated legacy file is isolated; a registered attempt retains its immutable routing.
        if (rows.has(run)) rows.get(run).error = error.message
      }
      if (rows.size > 10000) throw new Error('局部测量超过受管上限。')
    }
  }
  for (const row of rows.values()) if (!fs.existsSync(path.join(row.run, 'local-measurement.json')))
    row.error = '已登记局部测量缺失。'
  const caseInputs = equivalentCaseInputs(root,[...new Set([...rows.values()].flatMap(row=>Object.keys(row.measurement.cases)))])
  const legacy = Object.values(state.localFailures).filter(f => {
    const row = rows.get(f.run), m = row?.measurement
    if (!row?.registered || row.recordedAt !== f.completedAt ||
        !Array.isArray(row.recordedRequired) || !row.recordedRequired.length ||
        hash(row.recordedRequired) !== hash(f.required) || m.host !== measurementHost() || m.environment !== f.environment)
      return true
    // A matching path alone is insufficient: the authoritative route must still cover the current inputs.
    return Object.keys(m.cases).some(id => !caseInputs[id]?.includes(m.cases[id]))
  })
  const currentInput = legacy.length ? inputHash(root) : undefined
  const legacyFailures = legacy.filter(f => f.inputHash === currentInput)
  return { rows: [...rows.values()], errors, legacyFailures, caseInputs }
}

// Terminal authority is independent of the current execution fingerprint. Unknown
// historical positives are not reusable, but a canceled outer command is still a negative.
function assertTerminal(root, m, result, row) {
  if (row?.error) throw new Error(row.error)
  if (row?.registered && (row.recordedStatus !== 'passed' || row.recordedCancelled || row.recordedAt !== result.completedAt))
    throw new Error('执行前登记未取得一致的成功终态，不能由结果文件覆盖失败、取消或未完成。')
  if (result.status !== 'passed' || result.cancelled || result.failure)
    throw new Error('局部未取得成功终态。')
  assertEvidenceTerminal(root,m,result)
}

function checkedPartial(root, run, m, result, row) {
  assertTerminal(root, m, result, row)
  if (result.runId !== m.runId || result.simulatorId !== m.simulatorId ||
      result.completedAt < m.startedAt || result.measurementSeal !== partialSeal(run, m, result) ||
      JSON.stringify(Object.keys(m.cases)) !== JSON.stringify(result.executedCases))
    throw new Error('局部范围、摘要或归属不符。')
  const ui = (m.scheme ?? 'DictionaryTouch') === 'DictionaryTouch'
  if (ui && (!/^[a-f0-9]{64}$/.test(m.baseline ?? '') || result.configuration !== 'Release'))
    throw new Error('UI 基线或构建配置不符。')
  readEvidenceResult(root, run, result.inputHash, m.environment)
  if (ui) {
    const readback = result.timings?.find(t => t.coverage?.includes('native-readback/DictionaryTouch/Release'))
    if (readback?.status !== 'passed' || path.resolve(readback.log ?? '') !== path.join(run, 'readback.log'))
      throw new Error('局部缺少对应夹具的成功数据回读。')
    const selected = selection('--' + result.requested.kind, result.requested.name, [])
    assertUiReadback(selected, fs.readFileSync(readback.log, 'utf8'))
    assertUiInteractionLog(selected, fs.readFileSync(path.join(run, 'test.log'), 'utf8'))
  }
  return result
}

/** Formal CI receipts consume the same original seal, owner, baseline and terminal checks as aggregation. */
export function validateLocalPartial(root, run) {
  const snapshot = partialRuns(root), row = snapshot.rows.find(row => row.run === run)
  if (!row) return validateCapacityPartial(root,run)
  if (row.error) throw new Error('UI 原始登记缺失或损坏，不能只用归档报告通过。')
  const m = row.measurement, current = snapshot.caseInputs
  if (m.host !== measurementHost()) throw new Error('UI/原生原始封存不属于本宿主。')
  if (Object.keys(m.cases).some(id => !current[id]?.includes(m.cases[id])))
    throw new Error('UI 原始执行输入已失效。')
  return checkedPartial(root, run, m, read(path.join(run, 'result.json')), row)
}

/** One failure authority for native and UI. A local native repair never replaces the full SQLite suite. */
export function partialFailureStatus(root, suite, environment, snapshot) {
  const ui = suite.kind === 'ui', native = suite.kind === 'full' && suite.mode === 'ios-smoke'
  if (!ui && !native) return { failureTimes: {}, repairs: [], errors: [] }
  const expected = ui ? selection(suite.case ? '--case' : '--scenario', suite.case ?? suite.scenario, []).cases : []
  const relevant = id => ui ? expected.includes(id) : id.startsWith('NativeTests/')
  const failures = [], successes = [], errors = []
  for (const row of snapshot.rows) {
    const m = row.measurement
    const ids = Object.keys(m.cases ?? {}).filter(relevant)
    if (!ids.length || m.host !== measurementHost() || m.environment !== JSON.stringify(environment)) continue
    const current = snapshot.caseInputs ?? equivalentCaseInputs(root,ids)
    const matching = ids.filter(id => current[id]?.includes(m.cases[id]))
    const unproven = !matching.length
    // Unknown historical inputs cannot supply successes. A durable related negative
    // still prevents returning to an older green; do not claim it repaired by equivalence.
    if (unproven && !row.registered) continue
    const negativeIds = row.registered ? ids : matching
    let result
    const addFailure = (required, time) => {
      const targets = Array.isArray(required) && required.length && required.every(key =>
        typeof key === 'string' && (key.startsWith('case/') ? Object.hasOwn(m.cases, key.slice(5))
          : /^(?:native-|check\/|scenario\/|recovery\/)/.test(key))) ? required : negativeIds.map(id => 'case/' + id)
      for (let target of targets) {
        if (target.startsWith('case/') && !negativeIds.includes(target.slice(5))) continue
        const targetIds = target.startsWith('case/') ? [target.slice(5)] : negativeIds
        if (m.scenario && target === 'case/NativeTests/NativeSqliteTests/testOfflineDictionaryScenario') target = 'scenario/' + m.scenario
        failures.push({ target, time: Number.isSafeInteger(time) && time > 0 && time <= Date.now() ? time : m.startedAt,
          m, ids: targetIds, unproven: targetIds.some(id => !matching.includes(id)) })
      }
    }
    try {
      if (![1, 2].includes(m.schema) || !Number.isSafeInteger(m.startedAt) || m.startedAt <= 0 || m.startedAt > Date.now())
        throw new Error('登记时间或格式无效。')
      if (row.error) throw new Error(row.error)
      const file = path.join(row.run, 'result.json')
      result = fs.existsSync(file) ? read(file) : undefined
      if (unproven) {
        if (!result) throw new Error('已登记结果缺失。')
        assertTerminal(root,m,result,row)
        continue
      }
      if (!result || result.status !== 'passed') {
        const failure = failedAttempt(row, result)
        addFailure(failure.required, failure.time)
        continue
      }
      checkedPartial(root, row.run, m, result, row)
      successes.push({ run: row.run, m, result })
    } catch (error) {
      errors.push({ run: row.run, error: error.message })
      const failure = failedAttempt(row, result)
      addFailure(failure.required, failure.time)
    }
  }
  for (const f of snapshot.legacyFailures) {
    if (f.environment && f.environment !== JSON.stringify(environment)) continue
    for (const target of f.required ?? []) {
      const applicable = target.startsWith('case/') ? relevant(target.slice(5)) : native
        ? /^(scenario\/|recovery\/|native-.*\/App\/Debug)/.test(target)
        : /native-.*\/DictionaryTouch\/Release/.test(target)
      if (applicable) failures.push({ target, time: f.completedAt, legacy: f })
    }
  }
  const failureTimes = {}, repairs = []
  for (const f of failures) {
    const repaired = successes.find(proof => {
      if (f.unproven && f.target.startsWith('case/')) return false
      if (proof.m.startedAt <= f.time || !proof.result.coverage.includes(f.target)) return false
      if (f.legacy) {
        if (proof.result.inputHash !== f.legacy.inputHash) return false
      } else {
        const current = snapshot.caseInputs ?? equivalentCaseInputs(root,f.ids)
        if (!f.ids.some(id => current[id]?.includes(proof.m.cases[id]) &&
            (f.unproven || current[id]?.includes(f.m.cases[id])))) return false
        if (ui) {
          if (proof.m.runId !== f.m.runId || proof.m.simulatorId !== f.m.simulatorId) return false
          // A preparation failure may precede baseline capture. It can only be repaired by an
          // actually repeated preparation phase; case/readback failures still need the same baseline.
          const beforeBaseline = !f.m.baseline && /^(?:native-(?:build|install|initialize)\/DictionaryTouch\/Release(?:\/(?:app|runner))?|check\/(?:app-build|probe-build|resources\/source))$/.test(f.target)
          if (!beforeBaseline && (!f.m.baseline || proof.m.baseline !== f.m.baseline)) return false
        }
      }
      if (/^(native-|check\/)/.test(f.target)) return proof.m.schema === 2 && proof.result.timings?.some(t => t.status === 'passed' && t.coverage?.includes(f.target))
      return true
    })
    if (repaired) repairs.push({ target: f.target, run: repaired.run, completedAt: repaired.result.completedAt,
      ...(f.unproven ? {reverifiedCurrentTarget:true} : {}),
      reportHash: hash([read(path.join(repaired.run, 'result.json')), repaired.m]) })
    else failureTimes[f.target] = Math.max(failureTimes[f.target] ?? 0, f.time)
  }
  return { failureTimes, repairs, errors }
}

/** Independent checked fixtures can cover a suite; every proof retains its own readback and ownership. */
export function aggregatePartials(root, suite, environment, rows, barrier = 0, caseInputs) {
  if (suite.kind !== 'ui') return undefined
  const expected = selection(suite.case ? '--case' : '--scenario', suite.case ?? suite.scenario, []).cases
  const inputs = caseInputs ?? equivalentCaseInputs(root, expected)
  const candidates = new Map(), failures = new Map(), errors = []
  for (const row of rows) {
    const { run, measurement: m } = row
    const relevant = expected.filter(id => inputs[id]?.includes(m.cases?.[id]))
    const unproven = !relevant.length
    if (unproven && !row.registered) continue
    const negativeIds = row.registered ? expected.filter(id=>Object.hasOwn(m.cases,id)) : relevant
    if (!negativeIds.length) continue
    if (m.host !== measurementHost() || m.environment !== JSON.stringify(environment)) continue
    let result
    const rememberFailure = () => {
      const failure = failedAttempt(row, result)
      const targeted = Array.isArray(failure.required) ? failure.required.map(key =>
        typeof key === 'string' && key.startsWith('case/') ? key.slice(5) : undefined) : []
      const known = targeted.length && targeted.every(id => id && Object.hasOwn(m.cases, id))
      for (const id of negativeIds.filter(id => !known || targeted.includes(id)))
        failures.set(id, Math.max(failures.get(id) ?? 0, failure.time))
    }
    try {
      if (![1, 2].includes(m.schema) || m.host !== measurementHost() || m.environment !== JSON.stringify(environment) ||
          !Number.isSafeInteger(m.startedAt) || m.startedAt <= 0 || m.startedAt > Date.now())
        throw new Error('局部宿主、工具链或时间无效。')
      const file = path.join(run, 'result.json')
      result = fs.existsSync(file) ? read(file) : undefined
      if (unproven) {
        if (!result) throw new Error('已登记结果缺失。')
        assertTerminal(root,m,result,row)
        continue
      }
      if (!result || result.status !== 'passed') { rememberFailure(); continue }
      if (row.error) throw new Error(row.error)
      checkedPartial(root, run, m, result, row)
      const group = hash([m.runId, m.simulatorId, m.baseline, m.environment])
      if (!candidates.has(group)) candidates.set(group, new Map())
      for (const id of relevant) {
        const prior = candidates.get(group).get(id)
        if (!prior || prior.completedAt < result.completedAt)
          candidates.get(group).set(id, { run, completedAt: result.completedAt, startedAt: m.startedAt,
            reportHash: hash([fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(run, 'test.log'), 'utf8'),
              fs.readFileSync(path.join(run, 'readback.log'), 'utf8'), m]) })
      }
    } catch (error) {
      errors.push({ run, error: error.message })
      // Use the durable target/time even if the per-run result or measurement was lost.
      rememberFailure()
    }
  }
  let best = new Map()
  for (const group of candidates.values()) {
    const valid = new Map([...group].filter(([id, proof]) => proof.startedAt > Math.max(barrier, failures.get(id) ?? 0)))
    if (valid.size > best.size) best = valid
  }
  const proofs = [...best].map(([id, proof]) => ({ id, ...proof }))
  return { status: best.size === expected.length ? 'passed' : 'not-verified',
    missingCases: expected.filter(id => !best.has(id)), proofs, errors, failureTimes: Object.fromEntries(failures),
    measurementInput: suiteMeasurement(root, suite), reportHash: hash(proofs), host: measurementHost(),
    environmentHash: hash(environment), completedAt: Math.max(0, ...proofs.map(p => p.completedAt)) }
}
