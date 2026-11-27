import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { measurementHost } from './ios-evidence-inputs.mjs'
import { caseMeasurements } from './ios-execution-inputs.mjs'
import { readState, writeJson, evidenceRoot } from './ios-verification.mjs'
import { assertUiReadback, assertUiInteractionLog } from './ios-ui-readback.mjs'

// Execution-side registration and sealing. Consumer-only checks live in ios-local-partials.
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const read = file => {
  if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) throw new Error('局部测量必须为受管普通文件。')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function assertMeasurement(m) {
  const plainObject = value => value && typeof value === 'object' && !Array.isArray(value)
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
  const scheme = m?.scheme ?? 'DictionaryTouch'
  if (!plainObject(m) || ![1, 2].includes(m.schema) || !plainObject(m.cases) || !Object.keys(m.cases).length ||
      !Object.entries(m.cases).every(([id, value]) =>
        (scheme === 'App' ? /^NativeTests\/NativeSqliteTests\/test\w+$/ : /^DictionaryUITests\/DictionaryTouchTests\/test\w+$/).test(id) &&
        /^[a-f0-9]{64}$/.test(value)) || !['App', 'DictionaryTouch'].includes(scheme) ||
      !Number.isSafeInteger(m.startedAt) || m.startedAt <= 0 || m.startedAt > Date.now() ||
      !/^[a-f0-9]{64}$/.test(m.host ?? '') || !uuid.test(m.runId ?? '') || !uuid.test(m.simulatorId ?? '') ||
      typeof m.environment !== 'string' || !plainObject(JSON.parse(m.environment)) ||
      (m.schema === 2 && !/^\.local\/ios\/tmp\/ai-agent\/ios-invocation-[A-Za-z0-9]+\/result.json$/.test(m.invocation ?? '')))
    throw new Error('局部测量登记结构无效，保留失败锁并停止签发。')
}

/** Captured before execution. Legacy receipts cannot be retroactively assigned scoped inputs. */
export function partialMeasurement(root, selected, environment, session, invocation) {
  if (!['DictionaryTouch', 'App'].includes(selected.scheme)) return undefined
  return { schema: 2, startedAt: Date.now(), host: measurementHost(), environment,
    scheme: selected.scheme, scenario: selected.scenario,
    runId: session.context.runId, simulatorId: session.context.simulatorId,
    invocation: invocation && path.relative(root, path.join(invocation.run, 'result.json')),
    cases: caseMeasurements(root, selected.cases) }
}

/** Durable routing survives an interrupted/malformed per-run file; no failure history is removed. */
export function registerPartial(root, run, measurement) {
  assertMeasurement(measurement)
  const relative = path.relative(root, run)
  if (!/^\.local\/ios\/tmp\/ai-agent\/ios-debug-[A-Za-z0-9]+\/run-[A-Za-z0-9]+$/.test(relative))
    throw new Error('局部登记路径不属于受管会话。')
  const state = readState(root)
  state.localAttempts ??= {}
  if (Object.keys(state.localAttempts).length >= 10000) throw new Error('局部任务登记超过受管上限。')
  if (state.localAttempts[relative]) throw new Error('局部任务已登记，拒绝覆盖。')
  state.localAttempts[relative] = { measurement, status: 'running' }
  writeJson(path.join(evidenceRoot(root), 'ios-verification-state.json'), state)
}

export function partialSeal(run, measurement, result) {
  const artifacts = (measurement.scheme === 'App' ? ['test.log'] : ['test.log', 'readback.log', 'fixture.json']).map(name => {
    const file = path.join(run, name)
    if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) throw new Error('局部日志/夹具必须为普通文件。')
    return fs.readFileSync(file, 'utf8')
  })
  if (measurement.schema === 2) {
    if (!result) throw new Error('新格式局部证据缺少覆盖与阶段摘要。')
    const { requested, executedCases, configuration, inputHash, environment, runId, simulatorId, sourceHash, coverage, timings } = result
    return hash([measurement, { requested, executedCases, configuration, inputHash, environment, runId, simulatorId, sourceHash, coverage, timings }, ...artifacts])
  }
  return hash([measurement, ...artifacts])
}

export function finishPartialMeasurement(root, run, selected, result) {
  const measured = read(path.join(run, 'local-measurement.json'))
  const current = caseMeasurements(root, selected.cases)
  if (selected.cases.some(id => measured.cases[id] !== current[id]))
    throw new Error('执行期间相关测量输入变化，局部结果不能登记为通过。')
  if (selected.scheme === 'DictionaryTouch') {
    assertUiReadback(selected, fs.readFileSync(path.join(run, 'readback.log'), 'utf8'))
    assertUiInteractionLog(selected, fs.readFileSync(path.join(run, 'test.log'), 'utf8'))
  }
  return partialSeal(run, measured, result)
}

