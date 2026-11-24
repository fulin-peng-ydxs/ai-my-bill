import { isDeepStrictEqual as same } from 'node:util'
import { capacityReport } from './ios-capacity.mjs'
import { signingAuthorization } from './ios-signing.mjs'

const fail = message => { throw new Error('安装交付未完成：'+message) }
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
/** 工程完整候选、签名检查与两份目标真机原始证据必须同源；不负责签名或购买账号。 */
export function installationGate(ci,candidate,devices,signature,now = Date.now()) {
  if (ci?.status !== 'passed' || ci.profile !== 'final' || ci.completeCandidate !== true ||
      !same(ci.source,candidate?.source)) fail('缺少同源码完整工程候选')
  for (const suite of ['app-common','native-build','native-sqlite','touch','dependency-audit','scale-10000','scale-100000'])
    if (!ci.suites?.some(row=>row.suite===suite && row.status==='passed')) fail('缺少工程专项：'+suite)
  if (candidate.configuration !== 'Release' || candidate.workingTree !== false || candidate.debugger !== false ||
      candidate.appId !== 'com.mybill.offline' || !hash(candidate.artifactHash) || !hash(candidate.capacityArtifactHash) ||
      !hash(candidate.measurementSourceHash) || !candidate.version || !candidate.buildVersion || !candidate.teamId) fail('候选环境或制品无效')
  if (signature?.status !== 'passed' || signature.kind !== 'codesign' || !same(signature.source,candidate.source) ||
      ['artifactHash','appId','teamId'].some(key=>signature[key]!==candidate[key]) || !signature.deviceId ||
      !Number.isFinite(Date.parse(signature.checkedAt)) || Date.parse(signature.checkedAt)>now ||
      !(Date.parse(signature.profileExpiresAt)>now)) fail('签名未核验、归属不符或已过期')
  signingAuthorization(candidate,signature.authorization)
  if (!Array.isArray(devices) || devices.length !== 2) fail('缺少两种规模的目标真机报告')
  const counts = new Set(), observations = []
  for (const value of devices) {
    const receipt = value.receipt
    if (!receipt || receipt.mode !== 'device' || receipt.commit !== candidate.source.commit ||
        receipt.sourceHash !== candidate.measurementSourceHash || receipt.artifactHash !== candidate.capacityArtifactHash ||
        receipt.teamId !== candidate.teamId || receipt.deviceId !== signature.deviceId ||
        receipt.appVersion !== candidate.version || receipt.buildVersion !== candidate.buildVersion) fail('测量候选或设备不匹配')
    const result = capacityReport(receipt,value.observation,value.capture)
    if (counts.has(result.count)) fail('重复规模报告')
    counts.add(result.count)
    if (result.count===10000 ? result.status!=='passed' : !['passed','observed-over-target'].includes(result.status)) fail('性能、完整性或稳定性未通过')
    observations.push(result)
  }
  if (!counts.has(10000) || !counts.has(100000)) fail('规模缺失')
  return { schema:1,status:'passed',source:candidate.source,artifactHash:candidate.artifactHash,
    deviceId:signature.deviceId,checkedAt:new Date(now).toISOString(),deviceAcceptance:'passed',observations,evidence:{ci,candidate,devices,signature} }
}
