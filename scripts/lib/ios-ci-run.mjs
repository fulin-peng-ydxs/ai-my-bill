import { isDeepStrictEqual } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { assertPlan, digest, executionMatrix } from './ios-ci-plan.mjs'
import { audit, auditDependencies } from './ios-audit.mjs'
import { inputHash, requireEvidence, writeJson } from './ios-verification.mjs'
import { contentHash } from './ios-cache.mjs'
import { selection, nativeCases, uiCases,readSession,DEVICE_TYPE } from './ios-debug.mjs'
import { assertScriptReport, assertModePhases } from './ios-test-reports.mjs'
import { installationGate } from './ios-install-gate.mjs'
import { validateScenario } from './ios-scenario-evidence.mjs'
import { readScaleCold } from './ios-scale-run.mjs'
import { coverageReport } from './ios-coverage.mjs'
import { runCommand } from './ios-processes.mjs'
import { errorMessage } from './ios-errors.mjs'
import { assertBootStatus } from './ios-boot-proof.mjs'

const read = (file) => JSON.parse(plainFile(file))

/** 计划和报告始终留在本项目 iOS 私有目录；拒绝符号链接和跨工作区结果目录。 */
export function resultsDirectory(root, input, create = false) {
  const base = path.join(root, '.local/ios/tmp/ai-agent'),
    absolute = path.resolve(root, input)
  if (path.dirname(absolute) !== base || !/^ios-ci-[A-Za-z0-9-]+$/.test(path.basename(absolute)))
    throw new Error('CI 结果必须位于 .local/ios/tmp/ai-agent/ios-ci-*。')
  // 在 mkdir 之前逐级拒绝链接，不能先经链接创建目录再报错。
  let parent = root
  for (const part of path.relative(root, base).split(path.sep)) {
    parent = path.join(parent, part)
    if (!fs.existsSync(parent) && create) fs.mkdirSync(parent, { mode: 0o700 })
    if (!fs.lstatSync(parent).isDirectory() || fs.realpathSync(parent) !== parent)
      throw new Error('CI 结果父目录不能经符号链接。')
  }
  if (create) fs.mkdirSync(absolute, { mode: 0o700 })
  if (fs.realpathSync(base) !== base || fs.realpathSync(absolute) !== absolute)
    throw new Error('CI 结果目录不能经符号链接。')
  return absolute
}

// 兼容原 CI 调用方；App 启动取证直接复用底层执行器，避免加载整套 CI/规划模块。
export { runCommand } from './ios-processes.mjs'

function plainFile(file) {
  if (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file)
    throw new Error('CI 报告必须为普通文件。')
  return fs.readFileSync(file)
}
function marker(output, key) {
  const matches = [...output.matchAll(new RegExp('^' + key + '=(.+)$', 'gm'))]
  if (matches.length !== 1) throw new Error('执行器缺少唯一 ' + key + ' 回执。')
  return matches[0][1].trim()
}

/** 拷贝原执行器的实际回执及阶段日志/报告；总对账不依赖另一台机器的绝对沙盒路径。 */
function collectEvidence(root, directory, proof, role) {
  const base = path.join(root, '.local/ios/tmp/ai-agent')
  if (!proof.startsWith(base + path.sep) || fs.realpathSync(proof) !== proof)
    throw new Error('执行器回执不属于本项目。')
  const result = read(path.join(proof, 'result.json'))
  if (result.status !== 'passed') throw new Error('执行器回执未通过。')
  if (result.scope === 'partial') {
    if (/^scale-\d+$/.test(result.requested?.name ?? '')) {
      if (result.inputHash !== inputHash(root)) throw new Error('容量证据输入失效。')
      validateScenario(root,result.requested.name,result, name=>plainFile(path.join(proof,name)).toString(),name=>readScaleCold(path.join(proof,name)))
    } else requireEvidence(root, proof, inputHash(root), result.environment)
  }
  const files = new Set([path.join(proof, 'result.json')])
  for (const name of fs.readdirSync(proof))
    if (/\.(json|log)$/.test(name) && name !== 'active.json') files.add(path.join(proof, name))
  for (const phase of result.timings ?? [])
    for (const file of [phase.log, phase.report]) {
      if (file) {
        const absolute = path.resolve(root, file)
        if (!absolute.startsWith(base + path.sep)) throw new Error('阶段报告越出 iOS 私有目录。')
        if (fs.existsSync(absolute)) files.add(absolute)
        if (path.basename(absolute)==='coverage-proof.json')
          for (const name of ['coverage-final.json','coverage-summary.json']) files.add(path.join(path.dirname(absolute),name))
      }
    }
  return [...files].map((file, index) => {
    const bytes = plainFile(file),
      relative = `reports/${role}-${index}-${path.basename(file)}`
    fs.mkdirSync(path.join(directory, 'reports'), { recursive: true })
    fs.writeFileSync(path.join(directory, relative), bytes, { flag: 'wx', mode: 0o600 })
    return {
      path: relative,
      origin: path.relative(base, file),
      hash: digest(bytes),
      role,
      primary: file === path.join(proof, 'result.json')
    }
  })
}

/** 同一组复用本轮独立模拟器；完整入口继续要求新局部证据并自行执行全部原门禁。 */
export async function executeGroup(root, directory, group, { command = runCommand,session:borrowedSession } = {}) {
  const groupStarted = performance.now()
  const plan = assertPlan(root, read(path.join(directory, 'ci-plan.json')))
  if (!['linux', 'macos'].includes(group)) throw new Error('未知 CI 执行组。')
  const suites = plan.suites.filter((s) => s.runner === group)
  if (!suites.length) throw new Error('计划没有该执行组。')
  const budgetMs =
    executionMatrix(plan).include.find((item) => item.group === group).timeout * 60_000
  const remaining = () => {
    const left = budgetMs - (performance.now() - groupStarted)
    if (left <= 0) throw new Error('CI 执行组整轮超时，停止后续套件。')
    return Math.ceil(left)
  }
  if (group === 'macos' && process.platform !== 'darwin')
    throw new Error('macOS 专项必须在 macOS 执行。')
  if (borrowedSession && group!=='macos') throw new Error('仅 macOS 原生组可复用模拟器。')
  if (borrowedSession && suites.some(s=>s.kind==='environment'))
    throw new Error('启动环境专项要求本轮新会话，不能复用旧启动回执。')
  if (borrowedSession) readSession(path.join(root,'.local/ios/tmp/ai-agent'),borrowedSession)
  const groupFile = path.join(directory, `group-${group}.json`)
  fs.writeFileSync(groupFile, JSON.stringify({ status: 'running', plan: plan.id }), {
    flag: 'wx',
    mode: 0o600
  })
  let session = borrowedSession, error, closeAttempted = false
  const needsSession = suites.some(s => ['full','ui','scenario'].includes(s.kind))
  const closeSession = async () => {
    if(!session || closeAttempted)return
    closeAttempted=true
    await command(root,'bash',
      ['scripts/ios-app.sh','debug',borrowedSession?'suspend':'close','--session',session],
      path.join(directory,'close-session.log'),
      Math.max(1,Math.min(120_000,budgetMs-(performance.now()-groupStarted))))
    session=undefined
  }
  const ensureSession = async () => {
    if (!session) {
      session = marker(
        await command(
          root,
          'bash',
          ['scripts/ios-app.sh', 'debug', 'create', '--boot','--after-boot',needsSession?'suspend':'close'],
          path.join(directory, 'create-session.log'),
          Math.min(300_000, remaining())
        ),
        'SESSION'
      )
      if(!needsSession) {
        const closed=session
        session=undefined
        closeAttempted=true
        return closed
      }
    }
    return session
  }
  try {
    // 新宿主先验证最小可启动环境；同一受管会话随后用于业务测试，不先消耗 SDK 编译。
    if (!borrowedSession && needsSession) await ensureSession()
    for (const suite of suites) {
      assertPlan(root, plan)
      const dest = path.join(directory, suite.name)
      fs.mkdirSync(dest, { mode: 0o700 })
      const file = path.join(dest, 'receipt.json'),
        startedAt = Date.now(),
        started = performance.now()
      const receipt = {
        schema: 1,
        plan: plan.id,
        suite: suite.name,
        definition: digest(suite),
        source: plan.source,
        platform: process.platform,
        node: process.version,
        status: 'running',
        startedAt,
        reports: []
      }
      writeJson(file, receipt)
      let index = 0
      const exec = async (args) => {
        const log = path.join(dest, `command-${index++}.log`)
        return command(
          root,
          'bash',
          ['scripts/ios-app.sh', ...args],
          log,
          Math.max(1, Math.min(remaining(), 2_700_000 - (performance.now() - started)))
        )
      }
      try {
        if (suite.kind === 'environment') {
          const directory = await ensureSession()
          const owned = readSession(path.join(root,'.local/ios/tmp/ai-agent'),directory,!needsSession)
          const readiness = read(path.join(directory,'boot-readiness.json'))
          if (readiness.simulatorId !== owned.context.simulatorId || readiness.runId !== owned.context.runId)
            throw new Error('启动预检回执不属于本轮设备。')
          const lifecycle=read(path.join(directory,'boot-lifecycle.json'))
          if(lifecycle.action!==(needsSession?'suspend':'close') || (!needsSession && owned.context.state!=='closed'))throw new Error('启动后设备未完成本轮生命周期。')
          writeJson(path.join(dest,'environment.json'),{source:plan.source,readiness,lifecycle})
          for (const name of ['boot-status.log'])
            fs.writeFileSync(path.join(dest,name),plainFile(path.join(directory,name)),{flag:'wx',mode:0o600})
        } else if (suite.kind === 'installation') {
          await command(root,process.execPath,['scripts/ios-install-gate.mjs',path.join(directory,'install-input.json'),path.join(dest,'install-report.json')],path.join(dest,'install.log'),Math.min(120000,remaining()))
        } else if (suite.kind === 'audit') {
          const report = await audit(root, { budgetMs: Math.min(120_000, remaining()) })
          fs.writeFileSync(path.join(dest, 'audit.json'), JSON.stringify(report, null, 2), {
            flag: 'wx',
            mode: 0o600
          })
          if (report.status !== 'passed')
            throw new Error(`依赖审计发现 ${report.findings.length} 项已知漏洞。`)
        } else if (suite.kind === 'quality') {
          await command(root, 'python3', ['scripts/lib/ios-security.py', 'quality'], path.join(dest, 'quality.log'), Math.min(180000, remaining()))
        } else if (suite.kind === 'secrets') {
          await command(
            root,
            'bash',
            ['scripts/check-secrets.sh', ...(suite.name === 'secrets-history' ? ['--history'] : plan.range ? ['--base', plan.range.mergeBase ?? plan.range.base] : [])],
            path.join(dest, 'secrets.log'),
            Math.min(300_000, remaining())
          )
        } else {
          let proof
          if (suite.kind === 'check')
            proof = marker(await exec(['debug', 'check', '--check', suite.check]), 'EVIDENCE')
          if (suite.kind === 'engineering') proof = marker(await exec([suite.mode]), 'CI_RESULT')
          if (suite.kind === 'scenario') proof = marker(await exec(['debug','run','--session',await ensureSession(),'--scenario',suite.scenario]),'EVIDENCE')
          if (suite.kind === 'ui')
            proof = marker(
              await exec([
                'debug',
                'run',
                '--session',
                await ensureSession(),
                suite.case ? '--case' : '--scenario',
                suite.case ?? suite.scenario
              ]),
              'EVIDENCE'
            )
          if (suite.kind === 'full') {
            const local = marker(
              await exec([
                'debug',
                'check',
                '--check',
                'app-tests',
                ...(suite.mode === 'ios-touch'
                  ? ['--file', 'src/views/me/dictionaries/DictionaryDetailView.spec.ts']
                  : [])
              ]),
              'EVIDENCE'
            )
            receipt.reports.push(...collectEvidence(root, dest, local, 'precondition'))
            proof = marker(
              await exec([suite.mode, '--session', await ensureSession(), '--from', local]),
              'CI_RESULT'
            )
          }
          receipt.reports.push(...collectEvidence(root, dest, proof, 'primary'))
        }
        for (const name of fs
          .readdirSync(dest)
          .filter((n) => /\.(log|json)$/.test(n) && n !== 'receipt.json'))
          receipt.reports.push({
            path: name,
            hash: digest(plainFile(path.join(dest, name))),
            role: 'command'
          })
        if (performance.now() - started > 2_700_000) throw new Error('套件整轮超时。')
        assertPlan(root, plan)
        // 执行组内即拒绝不完整报告，避免在已知缺口后继续启动其他专项；汇总仍独立复核。
        validateReports(root, dest, suite, receipt,plan)
        remaining()
        receipt.status = 'passed'
        receipt.exit = 0
      } catch (e) {
        receipt.status = 'failed'
        receipt.exit = 1
        receipt.error = errorMessage(e)
        throw e
      } finally {
        receipt.completedAt = Date.now()
        receipt.durationMs = performance.now() - started
        writeJson(file, receipt)
      }
    }
  } catch (e) {
    error = e
  } finally {
    if (session && !closeAttempted) {
      try { await closeSession() } catch (e) { error ??= e }
    }
    if (performance.now() - groupStarted > budgetMs) error ??= new Error('CI 执行组整轮超时。')
    writeJson(groupFile, {
      schema: 1,
      plan: plan.id,
      status: error ? 'failed' : 'passed',
      error: error ? errorMessage(error) : undefined,
      budgetMs,
      durationMs: performance.now() - groupStarted
    })
  }
  if (error) throw error
}

/** 逐份核实原报告；只收集到成功 exit 或手填 passed 不能补足实际执行证据。 */
function validateReports(root, directory, suite, receipt,plan) {
  if (!receipt.reports?.length) throw new Error('缺少实际报告。')
  const primary = []
  for (const report of receipt.reports) {
    if (
      typeof report.path !== 'string' ||
      path.isAbsolute(report.path) ||
      report.path.split('/').includes('..')
    )
      throw new Error('报告路径越界。')
    const bytes = plainFile(path.join(directory, report.path))
    if (digest(bytes) !== report.hash) throw new Error('原报告摘要不符。')
    if (report.primary && report.role === 'primary') primary.push(JSON.parse(bytes))
  }
  if (suite.kind === 'environment') {
    const {source,readiness:r,lifecycle:life} = read(path.join(directory,'environment.json'))
    const environment = JSON.parse(r?.environment ?? 'null')
    const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
    if (!isDeepStrictEqual(source,receipt.source) || r?.schema!==3 || r.startupMode!=='bootstatus-b' || r?.scope!=='environment' || r.status!=='passed' ||
      r.deviceState!=='Booted' || r.initialDevice?.udid!==r.simulatorId ||
      r.initialDevice?.state!=='Shutdown' || r.initialDevice?.name!=='我的账单调试-'+r.runId ||
      r.initialDevice?.deviceTypeIdentifier!==DEVICE_TYPE || r.initialDevice?.isAvailable!==true || !uuid.test(r.simulatorId??'') || !uuid.test(r.runId??'') ||
      r.budgetMs!==120000 || !Number.isFinite(r.startedAt) || !Number.isFinite(r.completedAt) ||
      r.completedAt<=r.startedAt || r.completedAt>(receipt.completedAt??Date.now()) ||
      !/^27\./.test(environment?.sdk??'') || !/^Xcode 27\./.test(environment?.xcode??'') || !environment?.runtime || r.elapsedMs!==r.completedAt-r.startedAt || r.elapsedMs>r.budgetMs ||
      !receipt.reports.some(x=>x.path==='boot-status.log') ||
      typeof r.tool?.program!=='string' || !['sdk-wrapper','sdk-binary','installed-binary'].includes(r.tool?.mode) ||
      !Array.isArray(r.commands) || r.commands.length!==2 ||
      r.commands.some((step,index)=>step.program!==r.tool.program || step.stage!==['verify-device','boot-ready'][index] || step.status!=='passed' ||
        !Number.isSafeInteger(step.pid) || step.pid<=1 || !Number.isFinite(step.startedAt) ||
        !Number.isFinite(step.completedAt) || step.completedAt<step.startedAt || step.startedAt<r.startedAt ||
        step.completedAt>r.completedAt || (index>0 && step.startedAt<r.commands[index-1].completedAt)))
      throw new Error('模拟器启动环境回执未通过、范围或来源不符。')
    const operations=life?.action==='close'?['delete']:life?.action==='suspend'?['shutdown']:[]
    if(life?.schema!==1 || life.action!==(plan.suites.some(s=>s.runner===suite.runner && ['full','ui','scenario'].includes(s.kind))?'suspend':'close') || life.status!=='passed' || life.simulatorId!==r.simulatorId || life.runId!==r.runId ||
      life.budgetMs!==120000 || !Number.isFinite(life.durationMs) || life.durationMs<0 || life.durationMs>120000 ||
      !Number.isFinite(life.startedAt) || !Number.isFinite(life.completedAt) || life.startedAt<r.completedAt || life.completedAt<life.startedAt || life.completedAt>(receipt.completedAt??Date.now()) ||
      !operations.length || life.commands?.length!==operations.length || life.commands.some((step,index)=>step.operation!==operations[index] ||
        step.status!=='passed' || step.exit!==0 || step.program!==r.tool.program || !Number.isSafeInteger(step.pid) || step.pid<=1 ||
        !Number.isFinite(step.startedAt) || !Number.isFinite(step.completedAt) || step.completedAt<step.startedAt || step.startedAt<life.startedAt || step.completedAt>life.completedAt ||
        (index>0 && step.startedAt<life.commands[index-1].completedAt)))throw new Error('启动后生命周期回执未通过或归属不符。')
    assertBootStatus(plainFile(path.join(directory,'boot-status.log')).toString('utf8'),r.simulatorId)
    return
  }
  if (suite.kind === 'installation') {
    const value = read(path.join(directory,'install-report.json'))
    const evidence = value.evidence
    if (!evidence) throw new Error('安装汇总缺少原始报告。')
    const checked = installationGate(evidence.ci,evidence.candidate,evidence.devices,evidence.signature)
    if (['source','artifactHash','deviceId','observations'].some(key=>JSON.stringify(value[key])!==JSON.stringify(checked[key])))
      throw new Error('安装汇总与原始报告不符。')
    if (value.status !== 'passed' || value.deviceAcceptance !== 'passed' || !isDeepStrictEqual(value.source,receipt.source))
      throw new Error('安装交付报告未通过或源码不符。')
    return
  }
  if (suite.kind === 'audit') {
    const result = read(path.join(directory, 'audit.json')),
      inventory = auditDependencies(root)
    if (
      result.status !== 'passed' ||
      result.count !== inventory.dependencies.length ||
      result.findings?.length !== 0 ||
      JSON.stringify(result.dependencies) !==
        JSON.stringify(inventory.dependencies.map((d) => d.label)) ||
      !Number.isFinite(Date.parse(result.checkedAt))
    )
      throw new Error('依赖审计覆盖不足或未通过。')
    return
  }
  if (suite.kind === 'quality') {
    if (!receipt.reports.some(r => r.path === 'quality.log')) throw new Error('工作流质量检查未执行。')
    return
  }
  if (suite.kind === 'secrets') {
    if (!receipt.reports.some((r) => r.path === 'secrets.log')) throw new Error('密钥检查未执行。')
    return
  }
  if (primary.length !== 1 || primary[0].status !== 'passed')
    throw new Error('缺少唯一原执行器通过回执。')
  const result = primary[0]
  const raw = (origin) => {
    const report = receipt.reports.find((r) => r.role === 'primary' && r.origin === origin)
    if (!report) throw new Error('缺少原阶段日志或报告：' + origin)
    return fs.readFileSync(path.join(directory, report.path), 'utf8')
  }
  const phaseRaw = (file) => {
    const marker = '.local/ios/tmp/ai-agent/'
    if (!file?.includes(marker)) throw new Error('原阶段报告路径无效。')
    return raw(file.slice(file.lastIndexOf(marker) + marker.length))
  }
  const scriptSummary = (log) => assertScriptReport(root, log, receipt.platform)
  if (
    suite.kind === 'check' &&
    (result.scope !== 'partial' || result.check !== suite.check || result.command?.exit !== 0)
  )
    throw new Error('局部检查回执范围不符。')
  if (suite.kind === 'check') {
    const report = receipt.reports.find(
      (r) => r.role === 'primary' && r.path.endsWith('-check.log')
    )
    scriptSummary(report ? fs.readFileSync(path.join(directory, report.path), 'utf8') : '')
  }
  if (['engineering', 'full'].includes(suite.kind) && result.mode !== suite.mode)
    throw new Error('原生模式不符。')
  if (suite.kind === 'engineering' && result.scope !== 'engineering')
    throw new Error('工程回执不符。')
  if (
    suite.kind === 'full' &&
    (!result.fingerprint || !result.evidenceRuns?.length || !result.timings?.length)
  )
    throw new Error('完整验收缺少证据锁或阶段执行记录。')
  if (suite.kind === 'full') {
    const prerequisites = receipt.reports
      .filter((r) => r.role === 'precondition' && r.primary)
      .map((r) => read(path.join(directory, r.path)))
    if (
      prerequisites.length !== 1 ||
      prerequisites[0].scope !== 'partial' ||
      prerequisites[0].status !== 'passed' ||
      prerequisites[0].check !== 'app-tests' ||
      prerequisites[0].inputHash !== result.inputHash
    )
      throw new Error('完整验收缺少同输入的实际局部前置回执。')
  }
  if (['engineering', 'full'].includes(suite.kind)) {
    assertModePhases(suite.mode, result.timings, phaseRaw)
    const tests = result.timings.find((p) => p.coverage?.includes('check/app-tests'))
    const scripts = result.timings.find((p) => p.coverage?.includes('check/script-tests'))
    const vitest = JSON.parse(phaseRaw(tests?.report))
    if (
      vitest.success !== true ||
      !(vitest.numTotalTests > 0) ||
      vitest.numPassedTests !== vitest.numTotalTests ||
      vitest.numFailedTests !== 0 ||
      vitest.numPendingTests !== 0
    )
      throw new Error('App 单测报告为空或执行不完整。')
    scriptSummary(phaseRaw(scripts?.log))
    const coverage = result.timings.find(p => p.coverage?.includes('check/app-coverage'))
    if (!coverage?.report) throw new Error('缺少覆盖率阶段报告。')
    const parent = path.posix.dirname(coverage.report)
    const checked = coverageReport(root,JSON.parse(phaseRaw(parent+'/coverage-final.json')),JSON.parse(phaseRaw(parent+'/coverage-summary.json')))
    if (JSON.stringify(checked) !== JSON.stringify(JSON.parse(phaseRaw(coverage.report))))
      throw new Error('覆盖率原报告与回执不符。')
    if (suite.mode === 'ios-smoke') {
      const native = result.timings.find((p) => p.stage === 'test' && p.log?.endsWith('/test.log'))
      const log = phaseRaw(native?.log)
      if (
        !nativeCases.every((name) => log.includes(` ${name}]' passed`)) ||
        !/Executed [1-9]\d* tests, with 0 failures/.test(log)
      )
        throw new Error('原生 SQLite 实际执行不完整。')
    }
    if (suite.mode === 'ios-touch') {
      const logs = result.timings
        .filter((p) => p.stage === 'test')
        .map((p) => phaseRaw(p.log))
        .join('\n')
      if (!uiCases.every((name) => logs.includes(` ${name}]' passed`)))
        throw new Error('完整触摸缺少已登记专项的实际用例。')
    }
  }
  if (suite.kind === 'scenario') {
    const reportFor = name => {
      const item = receipt.reports.find(r=>r.role==='primary' && r.origin?.endsWith('/'+name))
      if (!item) throw new Error('缺少专项原始报告：'+name)
      return path.join(directory,item.path)
    }
    validateScenario(root,suite.scenario,result,name=>plainFile(reportFor(name)).toString(),name=>readScaleCold(reportFor(name)))
  }
  if (suite.kind === 'ui') {
    const kind = suite.case ? 'case' : 'scenario'
    const target = suite.case ?? suite.scenario
    const expected = selection('--' + kind, target, []).cases
    if (
      result.requested?.kind !== kind ||
      result.requested.name !== target ||
      JSON.stringify(result.executedCases) !== JSON.stringify(expected)
    )
      throw new Error('UI 实际用例不符。')
    const logReport = receipt.reports.find(
      (r) => r.primary !== true && r.role === 'primary' && r.path.endsWith('-test.log')
    )
    const log = logReport ? fs.readFileSync(path.join(directory, logReport.path), 'utf8') : ''
    if (
      !expected.every((id) => log.includes(` ${id.split('/').at(-1)}]' passed`)) ||
      !log.includes(
        `Executed ${expected.length} test${expected.length === 1 ? '' : 's'}, with 0 failures`
      )
    )
      throw new Error('UI 实际执行数或原始日志不符。')
  }
}

/** 计划与实际逐项对账；未知/缺失/失败/取消/旧版本/篡改报告均不通过，不覆盖原失败回执。 */
export function reconcile(root, directory, jobsStatus, planStatus) {
  mergeArchives(root, directory)
  const plan = assertPlan(root, read(path.join(directory, 'ci-plan.json')))
  const rows = []
  const allowed = new Set(plan.suites.map((s) => s.name))
  for (const name of fs.readdirSync(directory)) {
    if (
      fs.lstatSync(path.join(directory, name)).isDirectory() &&
      name !== 'archives' &&
      !allowed.has(name)
    )
      throw new Error('出现计划外套件：' + name)
  }
  for (const suite of plan.suites) {
    const row = { suite: suite.name, status: 'not-executed' }
    try {
      const dest = path.join(directory, suite.name),
        receipt = JSON.parse(plainFile(path.join(dest, 'receipt.json')))
      if (
        receipt.schema !== 1 ||
        receipt.plan !== plan.id ||
        receipt.suite !== suite.name ||
        receipt.definition !== digest(suite) ||
        JSON.stringify(receipt.source) !== JSON.stringify(plan.source) ||
        !Number.isSafeInteger(receipt.startedAt) ||
        !Number.isSafeInteger(receipt.completedAt) ||
        receipt.completedAt < receipt.startedAt ||
        !/^v24\./.test(receipt.node) ||
        (suite.runner === 'macos' && receipt.platform !== 'darwin')
      )
        throw new Error('套件回执失败、版本或执行环境不符。')
      if (receipt.status !== 'passed' || receipt.exit !== 0)
        throw new Error(receipt.error ?? '套件未完成或取消。')
      const group = read(path.join(directory, `group-${suite.runner}.json`))
      if (group.plan !== plan.id || group.status !== 'passed')
        throw new Error('执行组未完成或清理失败。')
      validateReports(root, dest, suite, receipt,plan)
      row.status = 'passed'
    } catch (e) {
      row.status = e.code === 'ENOENT' ? 'not-executed' : 'failed'
      row.reason = errorMessage(e)
    }
    rows.push(row)
  }
  const result = {
    schema: 1,
    plan: plan.id,
    profile: plan.profile,
    execution:plan.execution,
    scope:plan.execution==='remote'?'common-checks':'selected-local-checks',
    localRequired:(plan.localRequired??[]).map(s=>({suite:s.name,status:'not-verified-here'})),
    source: plan.source,
    status:
      rows.every((r) => r.status === 'passed') &&
      (jobsStatus === undefined || jobsStatus === 'success') &&
      (planStatus === undefined || planStatus === 'success')
        ? 'passed'
        : 'incomplete',
    jobsStatus: jobsStatus ?? 'local',
    planStatus: planStatus ?? 'local',
    completeCandidate:
      plan.profile === 'final' &&
      rows.every((r) => r.status === 'passed') &&
      (jobsStatus === undefined || jobsStatus === 'success') &&
      (planStatus === undefined || planStatus === 'success'),
    suites: rows
  }
  writeJson(path.join(directory, 'ci-result.json'), result)
  fs.writeFileSync(
    path.join(directory, 'ci-result.md'),
    `CI ${plan.profile}: ${result.status}\n执行位置：${plan.execution}；完整候选：${result.completeCandidate}\n\n` +
      rows.map((r) => `- ${r.suite}: ${r.status}${r.reason ? ' — ' + r.reason : ''}`).join('\n') +
      '\n' + (result.localRequired.length?'本地专项（本运行未验证）：'+result.localRequired.map(x=>x.suite).join(', ')+'\n':''),
    { mode: 0o600 }
  )
  return result
}

/** 各 attempt 独立归档；重跑失败组不会覆盖旧现场，计划组可以来自不同合法 attempt。 */
export function archiveGroup(root, directory, group, attempt) {
  if (!['linux', 'macos'].includes(group) || !/^[1-9]\d*$/.test(String(attempt)))
    throw new Error('归档组或 attempt 无效。')
  const base = path.join(root, '.local/ios/tmp/ai-agent/ios-ci-archives')
  if (!fs.existsSync(base)) resultsDirectory(root, base, true)
  else resultsDirectory(root, base)
  const dest = path.join(base, `${group}-${attempt}`)
  fs.mkdirSync(dest, { mode: 0o700 })
  fs.writeFileSync(
    path.join(dest, 'attempt.json'),
    JSON.stringify({ schema: 1, group, attempt: Number(attempt) }),
    { flag: 'wx', mode: 0o600 }
  )
  if (fs.existsSync(directory))
    fs.cpSync(directory, dest, { recursive: true, errorOnExist: true, force: false })
  return base
}

/** 只选择每组最新 attempt，缺失/失败的最新组不能回退旧绿色；原始归档始终保留。 */
export function mergeArchives(root, directory) {
  const archives = path.join(directory, 'archives')
  if (!fs.existsSync(archives)) return
  if (fs.realpathSync(archives) !== archives) throw new Error('归档目录不能经链接。')
  const plan = assertPlan(root, read(path.join(directory, 'ci-plan.json'))),
    latest = new Map()
  for (const name of fs.readdirSync(archives)) {
    const match = /^(linux|macos)-([1-9]\d*)$/.exec(name)
    if (!match) throw new Error('未知归档目录：' + name)
    const dir = path.join(archives, name),
      meta = read(path.join(dir, 'attempt.json'))
    if (
      fs.realpathSync(dir) !== dir ||
      meta.group !== match[1] ||
      meta.attempt !== Number(match[2])
    )
      throw new Error('归档 attempt 不符。')
    if (!latest.has(meta.group) || meta.attempt > latest.get(meta.group).attempt)
      latest.set(meta.group, { ...meta, dir })
  }
  const selection = {}
  for (const group of new Set(plan.suites.map((s) => s.runner))) {
    const selected = latest.get(group)
    if (!selected) throw new Error('缺少执行组归档：' + group)
    const archivedPlan = read(path.join(selected.dir, 'ci-plan.json'))
    if (JSON.stringify(archivedPlan) !== JSON.stringify(plan))
      throw new Error('最新归档不是当前计划。')
    selection[group] = { attempt: selected.attempt, hash: contentHash(selected.dir, ['.']) }
  }
  const merged = path.join(directory, 'merged.json')
  if (fs.existsSync(merged)) {
    if (JSON.stringify(read(merged)) !== JSON.stringify(selection))
      throw new Error('归档变化，须使用新的对账目录，不能覆盖旧结论。')
    return
  }
  for (const [group, selected] of latest) {
    const names = plan.suites.filter((s) => s.runner === group).map((s) => s.name)
    if (!names.length) throw new Error('出现计划外执行组。')
    for (const name of fs.readdirSync(selected.dir)) {
      const source = path.join(selected.dir, name)
      if (fs.lstatSync(source).isDirectory() && !names.includes(name))
        throw new Error('归档含计划外套件。')
    }
    for (const name of [...names, `group-${group}.json`]) {
      const source = path.join(selected.dir, name),
        dest = path.join(directory, name)
      if (fs.existsSync(dest)) throw new Error('拒绝覆盖已有执行记录：' + name)
      if (fs.existsSync(source))
        fs.cpSync(source, dest, { recursive: true, errorOnExist: true, force: false })
    }
  }
  writeJson(merged, selection)
}
