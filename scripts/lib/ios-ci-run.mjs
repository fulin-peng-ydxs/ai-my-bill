import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { assertPlan, digest, executionMatrix } from './ios-ci-plan.mjs'
import { audit, auditDependencies } from './ios-audit.mjs'
import { inputHash, requireEvidence, writeJson } from './ios-verification.mjs'
import { contentHash } from './ios-cache.mjs'
import { selection, nativeCases, uiCases } from './ios-debug.mjs'
import { assertScriptReport, assertModePhases } from './ios-test-reports.mjs'
import { spawnManaged } from './ios-processes.mjs'

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

/** 不捕获到内存的大日志；超时/取消先通知原执行器清理，再限时终止进程组。 */
export async function runCommand(root, program, args, log, timeoutMs = 2_700_000,
  { cleanupGraceMs = 10_000 } = {}) {
  // 受控进程回归只缩短清理宽限；正式调用保留默认值，不提供 CLI/环境覆盖或延长预算。
  if (!Number.isSafeInteger(cleanupGraceMs) || cleanupGraceMs < 0 || cleanupGraceMs > 10_000)
    throw new Error('CI 清理宽限必须为 0 至 10000 毫秒。')
  const fd = fs.openSync(log, 'wx', 0o600)
  let child,
    timer,
    cleanup,
    cancelled = false
  const stop = () => {
    cancelled = true
    cleanup?.stop()
  }
  try {
    const code = await new Promise((resolve, reject) => {
      const managed = spawnManaged(program, args, {
        cwd: root,
        env: process.env,
        detached: true,
        stdio: ['ignore', fd, fd]
      }, { root, graceMs: cleanupGraceMs })
      child = managed.child
      cleanup = managed.cleanup
      child.once('error', reject)
      child.once('close', (code) => resolve(code))
      timer = setTimeout(stop, timeoutMs)
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    if (cancelled || code !== 0) throw new Error(`CI 命令失败或取消（exit=${code}），见 ${log}`)
    const size = fs.fstatSync(fd).size
    // 输出标识在命令收尾，最多读取尾部 64KiB；日志本体留存供失败诊断。
    const data = Buffer.alloc(Math.min(size, 65_536))
    const source = fs.openSync(log, 'r')
    try {
      fs.readSync(source, data, 0, data.length, size - data.length)
    } finally {
      fs.closeSync(source)
    }
    return data.toString('utf8')
  } catch (error) {
    cleanup?.stop('SIGKILL')
    throw error
  } finally {
    clearTimeout(timer)
    try {
      cleanup?.finish()
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      fs.closeSync(fd)
    }
  }
}

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
  if (result.scope === 'partial') requireEvidence(root, proof, inputHash(root), result.environment)
  const files = new Set([path.join(proof, 'result.json')])
  for (const name of fs.readdirSync(proof))
    if (/\.(json|log)$/.test(name) && name !== 'active.json') files.add(path.join(proof, name))
  for (const phase of result.timings ?? [])
    for (const file of [phase.log, phase.report]) {
      if (file) {
        const absolute = path.resolve(root, file)
        if (!absolute.startsWith(base + path.sep)) throw new Error('阶段报告越出 iOS 私有目录。')
        if (fs.existsSync(absolute)) files.add(absolute)
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
export async function executeGroup(root, directory, group, { command = runCommand } = {}) {
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
  const groupFile = path.join(directory, `group-${group}.json`)
  fs.writeFileSync(groupFile, JSON.stringify({ status: 'running', plan: plan.id }), {
    flag: 'wx',
    mode: 0o600
  })
  let session, error
  const ensureSession = async () => {
    if (!session)
      session = marker(
        await command(
          root,
          'bash',
          ['scripts/ios-app.sh', 'debug', 'create'],
          path.join(directory, 'create-session.log'),
          Math.min(300_000, remaining())
        ),
        'SESSION'
      )
    return session
  }
  try {
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
        if (suite.kind === 'audit') {
          const report = await audit(root, { budgetMs: Math.min(120_000, remaining()) })
          fs.writeFileSync(path.join(dest, 'audit.json'), JSON.stringify(report, null, 2), {
            flag: 'wx',
            mode: 0o600
          })
          if (report.status !== 'passed')
            throw new Error(`依赖审计发现 ${report.findings.length} 项已知漏洞。`)
        } else if (suite.kind === 'secrets') {
          await command(
            root,
            'bash',
            ['scripts/check-secrets.sh'],
            path.join(dest, 'secrets.log'),
            Math.min(300_000, remaining())
          )
        } else {
          let proof
          if (suite.kind === 'check')
            proof = marker(await exec(['debug', 'check', '--check', suite.check]), 'EVIDENCE')
          if (suite.kind === 'engineering') proof = marker(await exec([suite.mode]), 'CI_RESULT')
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
        validateReports(root, dest, suite, receipt)
        remaining()
        receipt.status = 'passed'
        receipt.exit = 0
      } catch (e) {
        receipt.status = 'failed'
        receipt.exit = 1
        receipt.error = e.message
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
    if (session) {
      try {
        await command(
          root,
          'bash',
          ['scripts/ios-app.sh', 'debug', 'close', '--session', session],
          path.join(directory, 'close-session.log'),
          Math.max(1, Math.min(120_000, budgetMs - (performance.now() - groupStarted)))
        )
      } catch (e) {
        error ??= e
      }
    }
    if (performance.now() - groupStarted > budgetMs) error ??= new Error('CI 执行组整轮超时。')
    writeJson(groupFile, {
      schema: 1,
      plan: plan.id,
      status: error ? 'failed' : 'passed',
      error: error?.message,
      budgetMs,
      durationMs: performance.now() - groupStarted
    })
  }
  if (error) throw error
}

/** 逐份核实原报告；只收集到成功 exit 或手填 passed 不能补足实际执行证据。 */
function validateReports(root, directory, suite, receipt) {
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
export function reconcile(root, directory, jobsStatus) {
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
      validateReports(root, dest, suite, receipt)
      row.status = 'passed'
    } catch (e) {
      row.status = e.code === 'ENOENT' ? 'not-executed' : 'failed'
      row.reason = e.message
    }
    rows.push(row)
  }
  const result = {
    schema: 1,
    plan: plan.id,
    profile: plan.profile,
    source: plan.source,
    status:
      rows.every((r) => r.status === 'passed') && (!jobsStatus || jobsStatus === 'success')
        ? 'passed'
        : 'incomplete',
    jobsStatus: jobsStatus ?? 'local',
    completeCandidate:
      plan.profile === 'final' &&
      rows.every((r) => r.status === 'passed') &&
      (!jobsStatus || jobsStatus === 'success'),
    suites: rows
  }
  writeJson(path.join(directory, 'ci-result.json'), result)
  fs.writeFileSync(
    path.join(directory, 'ci-result.md'),
    `CI ${plan.profile}: ${result.status}\n\n` +
      rows.map((r) => `- ${r.suite}: ${r.status}${r.reason ? ' — ' + r.reason : ''}`).join('\n') +
      '\n',
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
