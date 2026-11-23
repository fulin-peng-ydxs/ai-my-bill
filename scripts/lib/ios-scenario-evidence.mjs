import { selection,sourceHash } from './ios-debug.mjs'
import { capacityReport,scaleAppId } from './ios-capacity.mjs'

const fail = message => { throw new Error('专项报告无效：'+message) }
/** 本机及跨 runner 对账消费相同原始日志，不把部分规模输出记为完整观测。 */
export function validateScenario(root,scenario,result,raw,readCold) {
  const selected = selection('--scenario',scenario,[])
  if (result.scope !== 'partial' || result.status !== 'passed' || result.requested?.kind !== 'scenario' ||
      result.requested.name !== scenario || JSON.stringify(result.executedCases) !== JSON.stringify(selected.cases) ||
      !result.timings?.length || result.timings.some(p => p.status !== 'passed')) fail('范围、状态或阶段缺失')
  if (!selected.capacity) {
    const log = raw('test.log')
    for (const phase of selected.recoveryPhases ?? []) if (!log.includes('LEDGER_PROCESS_INTERRUPTION_RECOVERED '+phase)) fail('成对恢复未完成')
    if (!selected.recoveryPhases?.length) fail('未登记原生专项')
    return
  }
  if (selected.capacityPhase !== 'all') fail('CI 规模专项须包含完整准备、服务、页面和冷启动')
  const report = JSON.parse(raw('capacity-report.json')), receipt = report.receipt
  if (report.phase !== 'all' || !receipt || receipt.appId !== scaleAppId || receipt.mode !== 'simulator' || receipt.count !== selected.capacity ||
      receipt.configuration !== 'Release' || receipt.debugger !== false ||
      receipt.sourceHash !== sourceHash(root,result.environment) || result.sourceHash !== receipt.sourceHash ||
      receipt.deviceId !== result.simulatorId) fail('环境、源码或规模不符')
  const event = (file,label) => {
    const log = raw(file), matches = [...log.matchAll(new RegExp('^'+label+' (\\{[^\\r\\n]*\\})$','gm'))]
    if (!/\*\* TEST (?:EXECUTE )?SUCCEEDED \*\*/.test(log) || matches.length !== 1 || /Test Case .* failed/.test(log)) fail('原始执行未通过')
    return JSON.parse(matches[0][1])
  }
  const fixture = event('capacity-prepare.log','IOS_CAPACITY_FIXTURE')
  const native = event('capacity-native.log','IOS_CAPACITY_OBSERVATION')
  const pages = event('capacity-pages.log','IOS_CAPACITY_PAGES')
  const coldLog = raw('capacity-cold.log')
  if (!/\*\* TEST (?:EXECUTE )?SUCCEEDED \*\*/.test(coldLog)) fail('冷启动未完成')
  const cold = readCold('capacity-cold.log')
  const testLogs = ['capacity-prepare.log','capacity-native.log','capacity-pages.log','capacity-cold.log'].map(raw).join('\n')
  for (const id of selected.cases) if (!testLogs.includes(` ${id.split('/').at(-1)}]' passed`)) fail('实际用例未完整通过')
  for (const value of [fixture,native,pages,cold]) if (value.runId !== receipt.runId || value.sourceHash !== receipt.sourceHash ||
      value.artifactHash !== receipt.artifactHash || value.count !== receipt.count) fail('混入其他运行')
  if (pages.datasetId !== fixture.datasetId || cold.datasetId !== fixture.datasetId ||
      JSON.stringify(report.pages) !== JSON.stringify(pages) || JSON.stringify(report.cold) !== JSON.stringify(cold) ||
      JSON.stringify(report.fixtureReceipt) !== JSON.stringify(fixture)) fail('夹具或页面原始报告不符')
  const expected = capacityReport(receipt,native)
  for (const key of ['schema','status','deviceAcceptance','count','fixture','native'])
    if (JSON.stringify(report[key]) !== JSON.stringify(expected[key])) fail('原生报告不符')
  const metrics = ['list','filter','save','overview',...['DAY','WEEK','MONTH','QUARTER','YEAR'].map(x=>'time.'+x),
    ...['CATEGORY','PRODUCT','FUNDING_CHANNEL','PURCHASE_CHANNEL','LOCATION','HABIT','PRICE','FREQUENCY','QUALITY'].map(x=>'EXPENSE.'+x),
    ...['CATEGORY','FUNDING_CHANNEL','PAYER','NAME','FREQUENCY'].map(x=>'INCOME.'+x)]
  if (pages.correctness !== true || pages.crashed !== false) fail('页面正确性未通过')
  for (const key of metrics) if (!pages.samples?.[key]?.length || pages.samples[key].some(x=>!Number.isFinite(x)||x<=0) ||
    pages.spans?.[key]?.length !== pages.samples[key].length || pages.spans[key].some((window,i)=>!Number.isFinite(window.start)||!Number.isFinite(window.end)||Math.abs(window.end-window.start-pages.samples[key][i])>1)) fail('页面缺少指标或时间窗')
  if (!(report.memory?.samples?.length >= 2) || report.memory.samples.some(x =>
      !Number.isSafeInteger(x.appPid) || x.appPid <= 0 || !Number.isSafeInteger(x.webPid) || x.webPid <= 0 || x.appPid === x.webPid || !Number.isFinite(x.appBytes) || !Number.isFinite(x.webBytes) || !(x.appBytes>0) || !(x.webBytes>0))) fail('组合内存缺失')
  if (report.memory.peakBytes !== Math.max(...report.memory.samples.map(x=>x.appBytes+x.webBytes))) fail('内存峰值与样本不符')
  for (const id of selected.cases) if (!result.coverage?.includes('case/'+id) ||
      !result.timings.some(p=>p.coverage?.includes('case/'+id))) fail('缺少必需阶段')
}
