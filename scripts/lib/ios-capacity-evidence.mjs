import fs from 'node:fs'
import path from 'node:path'
import { selection, readSession, sourceHash } from './ios-debug.mjs'
import { inputHash, evidenceRoot, readState } from './ios-verification.mjs'
import { validateScenario } from './ios-scenario-evidence.mjs'
import { readScaleCold } from './ios-scale-run.mjs'
import { scaleAppId } from './ios-capacity.mjs'
import { assertCapacityMeasurement } from './ios-capacity-registration.mjs'
import { measurementHost } from './ios-evidence-inputs.mjs'
import { assertEvidenceTerminal } from './ios-evidence-terminal.mjs'
import { isDeepStrictEqual } from 'node:util'

/** Capacity consumes its durable pre-execution route, context, lease and real report.
 * App/UI registrations can never opt in; a capacity label or passed line is not proof.
 * Partial scale phases remain debug observations, not complete --from repair proofs.
 */
export function validateCapacityPartial(root, run) {
  const plain = name => {
    if (path.basename(name) !== name) throw new Error('容量证据文件名越界。')
    const file = path.join(run,name)
    if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile() || fs.statSync(file).size > 8*1024*1024)
      throw new Error('容量证据必须为有界受管普通文件。')
    return fs.readFileSync(file,'utf8')
  }
  const relative = path.relative(root,run),state = readState(root)
  if (state.localAttempts?.[relative]) throw new Error('App/UI 原始登记不能选择 Capacity 豁免。')
  const measured = state.capacityAttempts?.[relative]
  assertCapacityMeasurement(measured)
  if (!isDeepStrictEqual(measured,JSON.parse(plain('local-measurement.json'))))
    throw new Error('容量原始登记与执行前权威记录不符。')
  const session = readSession(fs.realpathSync(evidenceRoot(root)),path.dirname(run),true)
  const result = JSON.parse(plain('result.json'))
  const selected = selection('--'+result.requested?.kind,result.requested?.name,[])
  if (selected.scheme !== 'Capacity' || selected.capacityPhase !== 'all')
    throw new Error('原始登记缺失；只有完整容量真实报告可作 --from 证明。')
  if (measured.host !== measurementHost() || measured.inputHash !== inputHash(root) ||
      measured.target !== result.requested?.name || measured.environment !== result.environment ||
      measured.runId !== session.context.runId || measured.simulatorId !== session.context.simulatorId ||
      result.completedAt < measured.startedAt ||
      result.timings?.some(phase=>phase.startedAt < measured.startedAt))
    throw new Error('容量执行前登记的宿主、输入、范围、环境或时间不符。')
  assertEvidenceTerminal(root,measured,result)
  const context = JSON.parse(plain('capacity-context.json'))
  const report = JSON.parse(plain('capacity-report.json')), receipt = report.receipt
  if (result.cancelled || result.failure || result.inputHash !== inputHash(root) || result.configuration !== 'Release' ||
      result.runId !== session.context.runId || result.simulatorId !== session.context.simulatorId ||
      !Number.isSafeInteger(result.completedAt) || result.completedAt > Date.now() ||
      path.resolve(result.capacityReport ?? '') !== path.join(run,'capacity-report.json') ||
      !receipt || context.mode !== 'simulator' || context.deviceId !== session.context.simulatorId ||
      context.count !== selected.capacity || context.sourceHash !== sourceHash(root,result.environment) ||
      ['runId','mode','deviceId','count','sourceHash','artifactHash'].some(key=>context[key] !== receipt[key]))
    throw new Error('容量执行前登记与结果来源、规模或制品不符。')
  const leaseFile = path.join(session.directory,'capacity-owner.json')
  if (fs.realpathSync(leaseFile) !== leaseFile || !fs.lstatSync(leaseFile).isFile() || fs.statSync(leaseFile).size > 4096)
    throw new Error('容量安装归属登记无效。')
  const lease = JSON.parse(fs.readFileSync(leaseFile,'utf8'))
  if (lease.kind !== 'capacity' || lease.owner !== session.context.runId || lease.deviceId !== context.deviceId ||
      lease.appId !== scaleAppId || lease.artifactHash !== context.artifactHash)
    throw new Error('容量安装归属与执行前登记不符。')
  // Reuse the formal CI consumer, including raw events, all five cold samples, data and windows.
  validateScenario(root,result.requested.name,result,plain,name=>{
    const file = path.join(run,name)
    plain(name) // enforce ordinary-file/size/containment before the shared cold parser
    return readScaleCold(file)
  })
  return result
}
