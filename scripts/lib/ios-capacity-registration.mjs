import fs from 'node:fs'
import path from 'node:path'
import { partialMeasurement as originalMeasurement, registerPartial as originalRegister } from './ios-local-measurement.mjs'
import { measurementHost } from './ios-evidence-inputs.mjs'
import { selection } from './ios-debug.mjs'
import { readState, writeJson, evidenceRoot, inputHash } from './ios-verification.mjs'

/** Capacity-only adapter at the existing pre-execution hook. App/UI issuance delegates
 * unchanged to its fixed producer; Capacity binds this adapter through its full inputHash.
 */
export function partialMeasurement(root, selected, environment, session, invocation) {
  if (selected.scheme !== 'Capacity') return originalMeasurement(root,selected,environment,session,invocation)
  const suffix = selected.capacityPhase === 'all' ? '' : '-'+selected.capacityPhase+
    (selected.capacityColdIndices?.length === 1 ? '-'+String(selected.capacityColdIndices[0]+1).padStart(2,'0') : '')
  const target = 'scale-'+selected.capacity+suffix
  const file = invocation && path.join(invocation.run,'result.json')
  if (!file || fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile())
    throw new Error('容量执行前缺少受管命令登记。')
  const owner = JSON.parse(fs.readFileSync(file,'utf8'))
  if (owner.scope !== 'invocation' || owner.mode !== 'debug run' || owner.status !== 'running' ||
      owner.cancelled || owner.ownerPid !== invocation.ownerPid || !Number.isSafeInteger(owner.ownerPid) || owner.ownerPid <= 1 ||
      !Number.isSafeInteger(owner.startedAt) || owner.startedAt <= 0 || owner.startedAt > Date.now())
    throw new Error('容量执行前命令归属不符。')
  const measurement = { schema:1,kind:'capacity',target,cases:selected.cases,
    startedAt:Date.now(),host:measurementHost(),environment,inputHash:inputHash(root),
    runId:session.context.runId,simulatorId:session.context.simulatorId,
    invocation:path.relative(root,file),ownerPid:owner.ownerPid }
  assertCapacityMeasurement(measurement)
  return measurement
}

export function assertCapacityMeasurement(value) {
  const selected = selection('--scenario',value?.target,[]),uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
  const environment = typeof value?.environment === 'string' ? JSON.parse(value.environment) : undefined
  if (value?.schema !== 1 || value.kind !== 'capacity' || selected.scheme !== 'Capacity' ||
      JSON.stringify(value.cases) !== JSON.stringify(selected.cases) ||
      !Number.isSafeInteger(value.startedAt) || value.startedAt <= 0 || value.startedAt > Date.now() ||
      !Number.isSafeInteger(value.ownerPid) || value.ownerPid <= 1 ||
      !/^[a-f0-9]{64}$/.test(value.host ?? '') || !/^[a-f0-9]{64}$/.test(value.inputHash ?? '') ||
      !environment || typeof environment !== 'object' || Array.isArray(environment) ||
      !uuid.test(value.runId ?? '') || !uuid.test(value.simulatorId ?? '') ||
      !/^\.local\/ios\/tmp\/ai-agent\/ios-invocation-[A-Za-z0-9]+\/result.json$/.test(value.invocation ?? ''))
    throw new Error('容量执行前登记无效。')
}

export function registerPartial(root,run,measurement) {
  if (measurement?.kind !== 'capacity') return originalRegister(root,run,measurement)
  assertCapacityMeasurement(measurement)
  const relative = path.relative(root,run)
  if (!/^\.local\/ios\/tmp\/ai-agent\/ios-debug-[A-Za-z0-9]+\/run-[A-Za-z0-9]+$/.test(relative) ||
      fs.realpathSync(run) !== run || !fs.lstatSync(run).isDirectory())
    throw new Error('容量执行前登记路径无效。')
  const state = readState(root)
  state.capacityAttempts ??= {}
  if (typeof state.capacityAttempts !== 'object' || Array.isArray(state.capacityAttempts))
    throw new Error('容量权威登记损坏，不覆盖或清空。')
  if (state.localAttempts?.[relative] || state.capacityAttempts[relative] || Object.keys(state.capacityAttempts).length >= 10000)
    throw new Error('容量执行前登记重复、冲突或超过上限。')
  state.capacityAttempts[relative] = measurement
  writeJson(path.join(evidenceRoot(root),'ios-verification-state.json'),state)
}
