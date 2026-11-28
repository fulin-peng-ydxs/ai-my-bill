import { createHash } from 'node:crypto'

export const scaleAppId = 'com.mybill.offline.capacity'
export const scaleMetrics = ['coldStart','list','filter','save','overview',
  ...['DAY','WEEK','MONTH','QUARTER','YEAR'].map(x => 'time.'+x),
  ...['CATEGORY','PRODUCT','FUNDING_CHANNEL','PURCHASE_CHANNEL','LOCATION','HABIT','PRICE','FREQUENCY','QUALITY'].map(x => 'EXPENSE.'+x),
  ...['CATEGORY','FUNDING_CHANNEL','PAYER','NAME','FREQUENCY'].map(x => 'INCOME.'+x),'backup','restore']
export const sha256 = value => createHash('sha256').update(value).digest('hex')
const fail = message => { throw new Error('容量报告拒绝：'+message) }
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
const deviceIdentifier = value => uuid(value) || typeof value === 'string' && /^(?:[a-f0-9]{8}-[a-f0-9]{16}|[a-f0-9]{40})$/i.test(value)
const nativeMetrics = ['sqlite.list','sqlite.save','sqlite.overview',
  ...scaleMetrics.filter(x => x.startsWith('time.') || /^(EXPENSE|INCOME)\./.test(x)).map(x => 'sqlite.'+x),'files.backup','files.restore']
export function percentile95(values) {
  if (!Array.isArray(values) || !values.length || values.some(x => !Number.isFinite(x) || x <= 0)) fail('无效原始样本')
  return [...values].sort((a,b) => a-b)[Math.ceil(values.length * .95)-1]
}

/** 服务观测与页面计时分别登记；设备报告缺少端到端或组合内存时不能降级记通过。 */
export function capacityReport(receipt, observation, capture) {
  if (!uuid(receipt.runId) || !hash(receipt.sourceHash) || !hash(receipt.artifactHash) ||
      !/^[a-f0-9]{40}$/.test(receipt.commit ?? '') || !['simulator','device'].includes(receipt.mode) ||
      ![10000,100000].includes(observation.count) || observation.fixture?.version !== 1 ||
      observation.measurementScope !== 'native-services-not-page-e2e' || !observation.samples ||
      receipt.appId !== scaleAppId || observation.runId !== receipt.runId ||
      observation.sourceHash !== receipt.sourceHash || observation.artifactHash !== receipt.artifactHash ||
      receipt.count !== undefined && receipt.count !== observation.count) fail('来源、隔离或夹具不符')
  for (const key of nativeMetrics) {
    const minimum = receipt.mode === 'device' ? (key.startsWith('files.') ? 5 : 30) : key.startsWith('files.') ? 1 : 3
    if (!Array.isArray(observation.samples[key]) || observation.samples[key].length < minimum) fail('原生样本不足：'+key)
  }
  const native = Object.fromEntries(Object.entries(observation.samples).map(([key,values]) => [key,
    { rawMs:values,p95Ms:percentile95(values),maximumMs:Math.max(...values) }]))
  const result = { schema:1,receipt,fixture:observation.fixture,count:observation.count,native,
    status:'observed',deviceAcceptance:'not-verified',missing:[] }
  if (receipt.mode === 'simulator') {
    if (capture) fail('模拟器不能承接真机报告')
    return result
  }
  if (!capture) return { ...result,status:'incomplete',missing:['page-e2e','coldStart','combined-memory'] }
  if (receipt.configuration !== 'Release' || receipt.debugger !== false || receipt.workingTree !== false || receipt.deviceModel !== 'iPhone 14 Pro Max' ||
      receipt.iosVersion !== '27.2.1' || !deviceIdentifier(receipt.deviceId) || !receipt.teamId || !receipt.xcodeVersion ||
      !receipt.sqliteVersion || !receipt.pluginVersion || !receipt.appVersion || !receipt.buildVersion ||
      capture.runId !== receipt.runId || capture.sourceHash !== receipt.sourceHash || capture.artifactHash !== receipt.artifactHash ||
      capture.fixtureVersion !== observation.fixture.version || capture.count !== observation.count ||
      capture.deviceId !== receipt.deviceId || capture.scope !== 'page-e2e' || !hash(capture.evidenceHash) ||
      observation.runId !== receipt.runId || observation.sourceHash !== receipt.sourceHash || observation.artifactHash !== receipt.artifactHash) fail('设备、制品、数据或计时范围不一致')
  const extended = observation.count === 100000, judgments = {}
  const spans = []
  for (const metric of scaleMetrics) {
    const values = capture.samples?.[metric], heavy = ['coldStart','backup','restore'].includes(metric)
    if (!Array.isArray(values) || values.length < (heavy ? 5 : 30)) fail('样本不足：'+metric)
    const windows = capture.spans?.[metric]
    if (!Array.isArray(windows) || windows.length !== values.length || windows.some((x,i) =>
      !Number.isFinite(x.start) || !Number.isFinite(x.end) || x.end <= x.start || Math.abs(x.end-x.start-values[i]) > 1)) fail('计时窗口不符：'+metric)
    spans.push(...windows)
    const measured = heavy ? (percentile95(values),Math.max(...values)) : percentile95(values)
    const limit = (metric === 'coldStart' ? (extended ? 5 : 3) : ['list','filter','save'].includes(metric)
      ? (extended ? 1 : .5) : ['backup','restore'].includes(metric) ? (extended ? 30 : 10) : (extended ? 3 : 1)) * 1000
    judgments[metric] = { rawMs:values,measuredMs:measured,limitMs:limit,passed:measured <= limit }
  }
  const memory = capture.memory
  const coldWindows = capture.spans.coldStart
  const otherWindows = Object.entries(capture.spans).filter(([key]) => key !== 'coldStart').flatMap(([,value]) => value)
  const during = (at,windows) => windows.some(x => at >= x.start && at < x.end)
  const process = (pid,bytes) => Number.isSafeInteger(pid) && pid > 0 && Number.isFinite(bytes) && bytes > 0
  const absent = (pid,bytes) => pid === null && bytes === 0
  const validProcesses = x => {
    const app = process(x.appPid,x.appBytes), web = process(x.webPid,x.webBytes)
    if (app && web) return x.appPid !== x.webPid
    // 冷启动的进程退出/创建窗口可记录已证实的缺席，其他操作不能以零值代替采样。
    return x.phase === 'launch' && x.at >= Math.min(...coldWindows.map(w => w.start)) && x.at < Math.max(...coldWindows.map(w => w.end)) && !during(x.at,otherWindows)
      && (app || absent(x.appPid,x.appBytes)) && (web || absent(x.webPid,x.webBytes))
  }
  if (!Array.isArray(memory?.samples) || memory.samples.length < 2 || !hash(memory.evidenceHash) ||
      ['runId','sourceHash','artifactHash','deviceId'].some(key => memory[key] !== receipt[key]) || memory.count !== observation.count ||
      !Number.isFinite(memory.windowStart) || !Number.isFinite(memory.windowEnd) || memory.windowEnd <= memory.windowStart ||
      memory.samples.some((x,i,all) => !Number.isFinite(x.at) || x.at < memory.windowStart || x.at > memory.windowEnd ||
        i && x.at <= all[i-1].at || !validProcesses(x)) ||
      memory.samples.filter(x => process(x.appPid,x.appBytes) && process(x.webPid,x.webBytes)).length < 2 ||
      memory.samples[0].at > memory.windowStart + 500 || memory.samples.at(-1).at < memory.windowEnd - 500 ||
      memory.samples.some((x,i,all) => i && x.at - all[i-1].at > 500) ||
      memory.windowStart > Math.min(...spans.map(x => x.start)) || memory.windowEnd < Math.max(...spans.map(x => x.end))) fail('组合内存范围、来源、进程或采样缺失')
  const peakBytes = Math.max(...memory.samples.map(x => x.appBytes + x.webBytes))
  judgments.memory = { peakBytes,limitBytes:(extended ? 500 : 300)*1_000_000,passed:peakBytes <= (extended ? 500 : 300)*1_000_000 }
  if (capture.correctness !== true || capture.crashed !== false || capture.unboundedGrowth !== false) fail('正确性、崩溃或增长未通过')
  const passed = Object.values(judgments).every(value => value.passed)
  return { ...result,status:passed ? 'passed' : extended ? 'observed-over-target' : 'failed',deviceAcceptance:passed ? 'passed' : extended ? 'observation' : 'failed',
    judgments,capture }
}
