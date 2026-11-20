import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  createPlan,
  assertPlan,
  registry,
  selectSuites,
  changedPaths
} from '../lib/ios-ci-plan.mjs'
import { resultsDirectory, executeGroup, reconcile, runCommand } from '../lib/ios-ci-run.mjs'
import { requestedScope } from '../lib/ios-ci.mjs'
import { audit, auditDependencies, swiftLock } from '../lib/ios-audit.mjs'

const repository = new URL('../../', import.meta.url).pathname
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ios-ci-test-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (name, value) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
    return file
  }
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
  git('init', '-q')
  git('config', 'user.name', 'fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  write('.gitignore', '.local/\nnode_modules/\n')
  write('config/ios-ci.json', fs.readFileSync(path.join(repository, 'config/ios-ci.json'), 'utf8'))
  write(
    'app/ios/App/UITests/DictionaryTouchTests.swift',
    fs.readFileSync(path.join(repository, 'app/ios/App/UITests/DictionaryTouchTests.swift'), 'utf8')
  )
  write('scripts/check-secrets.sh', '#!/bin/sh\nprintf "SECRET_CHECK_EXECUTED\\n"\n')
  write('app/package-lock.json', {
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture' },
      'node_modules/example': { version: '1.0.0' },
      'node_modules/alias': { name: 'real-package', version: '2.0.0' }
    }
  })
  write(swiftLock, {
    version: 3,
    pins: [
      {
        identity: 'swift-example',
        location: 'https://github.com/example/swift.git',
        state: { revision: 'a'.repeat(40), version: '1.2.0' }
      }
    ]
  })
  const commit = () => {
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  const base = commit()
  return { root, write, git, commit, base }
}
function prepare(p, profile = 'secrets', suffix = 'result', range) {
  const plan = createPlan(p.root, profile, range)
  const directory = resultsDirectory(p.root, '.local/ios/tmp/ai-agent/ios-ci-' + suffix, true)
  fs.writeFileSync(path.join(directory, 'ci-plan.json'), JSON.stringify(plan))
  return { plan, directory }
}

test('CI 登记复用现有执行器与专项；固定范围、按需触发和非法请求拒绝', (t) => {
  const p = fixture(t),
    r = registry(p.root)
  assert.equal(
    selectSuites(r, 'scripts').some((s) => s.kind === 'full'),
    false
  )
  assert.equal(
    selectSuites(r, 'app').some((s) => s.kind === 'ui' || s.mode === 'ios-touch'),
    false
  )
  const full = selectSuites(r, 'final').map((s) => s.name)
  assert.ok(full.includes('touch') && full.includes('dependency-audit'))
  for (const profile of ['scripts', 'app', 'final', 'dependency-audit']) {
    assert.equal(
      requestedScope('workflow_dispatch', { inputs: { verification: profile } }).profile,
      profile
    )
    assert.equal(
      requestedScope('push', { ref: `refs/tags/ios-ci/${profile}/candidate` }).profile,
      profile
    )
  }
  assert.deepEqual(requestedScope('push', { ref: `refs/tags/ios-ci/change/${p.base}/candidate` }), {
    profile: 'change',
    base: p.base
  })
  for (const [name, event] of [
    ['push', { ref: 'refs/heads/codex/offline-ios-app' }],
    ['pull_request', {}],
    ['schedule', {}],
    ['push', { ref: 'refs/tags/v1' }],
    ['push', { ref: 'refs/tags/ios-ci/change/unknown/candidate' }],
    ['push', { ref: 'refs/tags/ios-ci/final/candidate', deleted: true }]
  ])
    assert.throws(() => requestedScope(name, event))
  for (const value of ['', null, true, 'unknown'])
    assert.throws(() => requestedScope('workflow_dispatch', { inputs: { verification: value } }))
  r.rules[0].suites.push('unknown')
  p.write('config/ios-ci.json', r)
  assert.throws(() => registry(p.root), /未知/)
})

test('CI 真实 Git 改名双向选择专项，普通文档和旧端不误触发 App/完整触摸', (t) => {
  for (const [from, to, required] of [
    ['app/src/views/ReportView.vue', 'scripts/old-report.mjs', 'ui-reports'],
    ['scripts/old-report.mjs', 'app/src/views/ReportView.vue', 'ui-reports'],
    ['app/package-lock.json', 'scripts/old-lock.json', 'dependency-audit'],
    ['scripts/normalize-capacitor-spm.mjs', 'scripts/old-normalize.mjs', 'native-sqlite']
  ]) {
    const p = fixture(t)
    p.write(from, 'moved content')
    const base = p.commit()
    fs.mkdirSync(path.dirname(path.join(p.root, to)), { recursive: true })
    p.git('mv', from, to)
    p.commit()
    const files = changedPaths(p.root, base, p.git('rev-parse', 'HEAD'))
    assert.ok(files.includes(from) && files.includes(to))
    const selected = selectSuites(registry(p.root), 'change', files).map((s) => s.name)
    assert.ok(selected.includes(required), from + ' -> ' + to)
    assert.ok(!selected.includes('touch'), '变更专项不隐式扩展为完整触摸')
  }
  const p = fixture(t),
    r = registry(p.root)
  for (const file of ['agent-works/notes/example.md', 'server/src/Old.java', 'web/src/Old.vue'])
    assert.deepEqual(
      selectSuites(r, 'change', [file]).map((s) => s.name),
      ['secrets']
    )
  const scripts = selectSuites(r, 'change', ['scripts/lib/ios-ci-plan.mjs']).map((s) => s.name)
  assert.deepEqual(scripts, ['secrets', 'scripts', 'scripts-macos'])
  assert.throws(() => createPlan(p.root, 'change'), /完整 base/)
  assert.throws(() => createPlan(p.root, 'change', { base: '0'.repeat(40) }))
})

test('CI 本地未提交及新增输入参与计划，篡改范围/登记/源码和旧 head 不能通过', (t) => {
  const p = fixture(t)
  p.write('app/src/views/LedgerView.vue', 'query')
  const plan = createPlan(p.root, 'change', { base: p.base })
  assert.ok(plan.suites.some((s) => s.name === 'ui-query-input'))
  assert.doesNotThrow(() => assertPlan(p.root, plan))
  const less = structuredClone(plan)
  less.suites = []
  assert.throws(() => assertPlan(p.root, less), /失效/)
  p.write('app/src/views/LedgerView.vue', 'changed again')
  assert.throws(() => assertPlan(p.root, plan), /失效/)
  p.commit()
  assert.throws(() => createPlan(p.root, 'scripts', { head: p.base }), /当前检出/)
})

test('CI 真实局部执行与总对账：未执行不绿，缺网络/Token 不阻塞本地，失败回执不可覆盖', async (t) => {
  const p = fixture(t),
    { directory } = prepare(p)
  assert.equal(reconcile(p.root, directory).status, 'incomplete')
  const state = p.write(
    '.local/ios/tmp/ai-agent/ios-verification-state.json',
    'preserve failure lock'
  )
  await executeGroup(p.root, directory, 'linux')
  const result = reconcile(p.root, directory)
  assert.equal(result.status, 'passed')
  assert.equal(result.completeCandidate, false)
  assert.equal(fs.readFileSync(state, 'utf8'), 'preserve failure lock')
  await assert.rejects(executeGroup(p.root, directory, 'linux'), /EEXIST/)
  assert.equal(reconcile(p.root, directory).status, 'passed')
  const failed = prepare(p, 'secrets', 'failure')
  await assert.rejects(
    executeGroup(p.root, failed.directory, 'linux', {
      command: async () => {
        throw new Error('expected process failure')
      }
    }),
    /expected/
  )
  assert.equal(reconcile(p.root, failed.directory).suites[0].status, 'failed')
})

test('CI 对账拒绝失败/取消/空报告/错误源码与参数、篡改或缺失原报告、清理失败及额外套件', async (t) => {
  const p = fixture(t),
    { directory } = prepare(p)
  await executeGroup(p.root, directory, 'linux')
  const original = JSON.parse(fs.readFileSync(path.join(directory, 'secrets/receipt.json')))
  for (const [name, mutate] of [
    ['failed', (r) => (r.status = 'failed')],
    ['running', (r) => (r.status = 'running')],
    ['wrong-plan', (r) => (r.plan = 'old')],
    ['wrong-suite', (r) => (r.suite = 'app-common')],
    ['wrong-source', (r) => (r.source.hash = 'old')],
    ['wrong-definition', (r) => (r.definition = 'old')],
    ['no-report', (r) => (r.reports = [])],
    ['escape', (r) => (r.reports[0].path = '../../outside')],
    ['wrong-node', (r) => (r.node = 'v18.0.0')]
  ]) {
    const clone = resultsDirectory(p.root, '.local/ios/tmp/ai-agent/ios-ci-' + name, true)
    fs.cpSync(directory, clone, { recursive: true })
    const receipt = structuredClone(original)
    mutate(receipt)
    fs.writeFileSync(path.join(clone, 'secrets/receipt.json'), JSON.stringify(receipt))
    assert.equal(reconcile(p.root, clone).status, 'incomplete', name)
  }
  fs.appendFileSync(path.join(directory, 'secrets/secrets.log'), 'tampered')
  assert.equal(reconcile(p.root, directory).status, 'incomplete')
  fs.writeFileSync(path.join(directory, 'secrets/secrets.log'), 'SECRET_CHECK_EXECUTED\n')
  fs.writeFileSync(
    path.join(directory, 'group-linux.json'),
    JSON.stringify({ plan: original.plan, status: 'failed' })
  )
  assert.equal(reconcile(p.root, directory).status, 'incomplete')
  fs.mkdirSync(path.join(directory, 'unexpected'))
  assert.throws(() => reconcile(p.root, directory), /计划外/)
})

test('CI 拒绝跨目录与符号链接回执；显式完整范围不能被局部绿色冒充', async (t) => {
  const p = fixture(t),
    { directory } = prepare(p)
  assert.throws(() => resultsDirectory(p.root, '/tmp/other-ci'))
  const link = path.join(p.root, '.local/ios/tmp/ai-agent/ios-ci-link')
  fs.symlinkSync(directory, link)
  assert.throws(() => resultsDirectory(p.root, link), /链接/)
  await executeGroup(p.root, directory, 'linux')
  const full = createPlan(p.root, 'final')
  fs.writeFileSync(path.join(directory, 'ci-plan.json'), JSON.stringify(full))
  const result = reconcile(p.root, directory)
  assert.equal(result.completeCandidate, false)
  assert.equal(result.status, 'incomplete')
})

const ok = (results) => ({ ok: true, json: async () => ({ results }) })
test('CI 依赖审计仅收集 App npm 和 Swift，别名/去重/分页及实际漏洞均有报告', async (t) => {
  const p = fixture(t),
    inventory = auditDependencies(p.root),
    requests = []
  assert.equal(inventory.npmCount, 2)
  assert.equal(inventory.swiftCount, 1)
  assert.ok(inventory.dependencies.some((d) => d.query.package?.name === 'real-package'))
  assert.ok(
    inventory.dependencies.some((d) => d.query.package?.name === 'https://github.com/example/swift')
  )
  const result = await audit(p.root, {
    request: async (url, args) => {
      assert.equal(url, 'https://api.osv.dev/v1/querybatch')
      const queries = JSON.parse(args.body).queries
      requests.push(queries)
      return requests.length === 1
        ? ok([{ vulns: [{ id: 'GHSA-fixture' }], next_page_token: 'next' }, {}, {}])
        : ok([{}])
    }
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.findings[0].id, 'GHSA-fixture')
  assert.equal(result.count, 3)
  assert.equal(requests[1].length, 1)
  assert.equal(requests[1][0].page_token, 'next')
  const clean = await audit(p.root, { request: async () => ok([{}, {}, {}]) })
  assert.equal(clean.status, 'passed')
  assert.equal(clean.count, 3)
})

test('CI 依赖审计拒绝网络/HTTP/缺项/异常 JSON/循环分页/超预算和无锁依赖', async (t) => {
  const p = fixture(t)
  for (const request of [
    async () => {
      throw new Error('offline')
    },
    async () => ({ ok: false, status: 503 }),
    async () => ok([]),
    async () => ok([null, {}, {}]),
    async () => ok([{ vulns: 'invalid' }, {}, {}]),
    async () => ok([{ vulns: [{}] }, {}, {}])
  ])
    await assert.rejects(audit(p.root, { request }))
  let calls = 0
  await assert.rejects(
    audit(p.root, {
      request: async () =>
        ok(++calls === 1 ? [{ next_page_token: 'loop' }, {}, {}] : [{ next_page_token: 'loop' }])
    }),
    /循环/
  )
  let clock = 0
  await assert.rejects(
    audit(p.root, { now: () => (clock += 130000), request: async () => ok([]) }),
    /预算/
  )
  p.write('app/package-lock.json', { lockfileVersion: 3, packages: { '': {} } })
  assert.throws(() => auditDependencies(p.root), /为空/)
  p.write('app/package-lock.json', {
    lockfileVersion: 3,
    packages: { 'node_modules/broken': { link: true } }
  })
  assert.throws(() => auditDependencies(p.root), /无法审计/)
})

test('CI 工作流矩阵由计划驱动，总对账与最终标记独立，不存在自动分支/定时运行或旧端服务', () => {
  const workflow = fs.readFileSync(
    path.join(repository, '.github/workflows/offline-ios.yml'),
    'utf8'
  )
  const trigger = workflow.slice(workflow.indexOf('on:\n'), workflow.indexOf('\npermissions:'))
  assert.match(trigger, /push:\n    tags:/)
  assert.doesNotMatch(trigger, /pull_request:|branches:|schedule:|paths:/)
  assert.match(workflow, /matrix: \$\{\{ fromJSON\(needs.plan.outputs.matrix\) \}\}/)
  assert.match(workflow, /run --results "\$IOS_CI_RESULTS" --group "\$IOS_CI_GROUP"/)
  assert.match(workflow, /result --results "\$IOS_CI_RESULTS"/)
  assert.match(workflow, /needs.result.outputs.complete == 'true'/)
  assert.match(workflow, /needs.checks.result == 'success'/)
  assert.match(workflow, /include-hidden-files: true/)
  assert.doesNotMatch(workflow, /GH_TOKEN:|actions: read|postgres|setup-java|--prefix (web|server)/)
  assert.ok(
    fs
      .readFileSync(path.join(repository, 'scripts/lib/ios-app-full.sh'), 'utf8')
      .includes('node scripts/lib/ios-checks.mjs run-script-tests')
  )
  assert.ok(
    fs
      .readFileSync(path.join(repository, 'scripts/lib/ios-verification.mjs'), 'utf8')
      .includes('scriptTestFiles(root)')
  )
})

test('CI 命令超时终止子进程并保留失败，不能被空输出记为通过', async (t) => {
  const p = fixture(t),
    log = path.join(p.root, 'timed.log'),
    started = Date.now()
  await assert.rejects(
    runCommand(p.root, process.execPath, ['-e', 'setInterval(()=>{},1000)'], log, 50),
    /失败或取消/
  )
  assert.ok(Date.now() - started < 3000)
  assert.ok(fs.existsSync(log))
})

test('CI 正式 CLI 本地 plan→run→result 与非法参数回归，不访问旧端或远端', (t) => {
  const p = fixture(t)
  fs.cpSync(path.join(repository, 'scripts/lib'), path.join(p.root, 'scripts/lib'), {
    recursive: true
  })
  p.write(
    'scripts/ios-ci.mjs',
    fs.readFileSync(path.join(repository, 'scripts/ios-ci.mjs'), 'utf8')
  )
  p.commit()
  const cli = (...args) =>
    spawnSync(process.execPath, ['scripts/ios-ci.mjs', ...args], {
      cwd: p.root,
      encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' }
    })
  const planned = cli('plan', 'secrets')
  assert.equal(planned.status, 0, planned.stderr)
  const output = JSON.parse(planned.stdout),
    dir = output.directory
  assert.equal(cli('result', '--results', dir).status, 1)
  assert.equal(cli('run', '--results', dir, '--group', 'linux').status, 0)
  const result = cli('result', '--results', dir)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).status, 'passed')
  assert.notEqual(
    cli('run', '--results', dir, '--group', 'linux').status,
    0,
    '失败/完成现场不能覆盖'
  )
  for (const args of [
    ['result', 'junk', '--results', dir],
    ['result', '--results', dir, '--base', p.base],
    ['run', '--results', dir, '--unknown', '1'],
    ['plan', 'change']
  ])
    assert.notEqual(cli(...args).status, 0, args.join(' '))
})

test('CI 原报告语义对账拒绝空单测、跳过、阶段缺失，即使被重新计算摘要也不能冒充通过', async (t) => {
  const p = fixture(t),
    proof = path.join(p.root, '.local/ios/tmp/ai-agent/ios-command-fixture')
  const appReport = path.join(proof, 'app-tests.json'),
    scriptLog = path.join(proof, 'script-tests.log')
  p.write('scripts/ios-app.sh', `#!/bin/sh\nprintf 'CI_RESULT=${proof}\\n'\n`)
  const { directory } = prepare(p, 'app-common')
  p.write(path.relative(p.root, appReport), {
    success: true,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0
  })
  p.write(
    path.relative(p.root, scriptLog),
    'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\n'
  )
  p.write(path.relative(p.root, path.join(proof, 'result.json')), {
    scope: 'engineering',
    status: 'passed',
    mode: 'common',
    timings: [
      { stage: 'check', coverage: ['check/app-tests'], report: appReport, status: 'passed' },
      { stage: 'check', coverage: ['check/script-tests'], log: scriptLog, status: 'passed' }
    ]
  })
  await executeGroup(p.root, directory, 'linux')
  assert.equal(reconcile(p.root, directory).status, 'passed')
  const receiptFile = path.join(directory, 'app-common/receipt.json'),
    receipt = JSON.parse(fs.readFileSync(receiptFile))
  const report = receipt.reports.find(
    (r) => r.role === 'primary' && r.path.endsWith('-app-tests.json')
  )
  const { digest } = await import('../lib/ios-ci-plan.mjs')
  for (const mutation of [
    { success: true, numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0 },
    { success: true, numTotalTests: 2, numPassedTests: 1, numFailedTests: 0, numPendingTests: 1 }
  ]) {
    const bytes = Buffer.from(JSON.stringify(mutation))
    fs.writeFileSync(path.join(directory, 'app-common', report.path), bytes)
    report.hash = digest(bytes)
    fs.writeFileSync(receiptFile, JSON.stringify(receipt))
    assert.equal(reconcile(p.root, directory).status, 'incomplete')
  }
})

test('CI 纯单测和局部草稿组件不误选全部 UI，固定候选不能删除安全/原生门禁', (t) => {
  const p = fixture(t),
    r = registry(p.root)
  assert.deepEqual(
    selectSuites(r, 'change', ['app/src/composables/useLedgerDraft.spec.ts']).map((s) => s.name),
    ['secrets', 'app-common']
  )
  const draft = selectSuites(r, 'change', ['app/src/components/DraftBackupNotice.vue']).map(
    (s) => s.name
  )
  assert.ok(draft.includes('ui-personal'))
  assert.ok(!draft.includes('ui-reports'))
  r.profiles.final = ['secrets']
  p.write('config/ios-ci.json', r)
  assert.throws(() => registry(p.root), /缺少必需/)
})

test('CI 计划和原报告可跨检出目录对账，不依赖生成报告主机的绝对路径', async (t) => {
  const p = fixture(t),
    { directory } = prepare(p)
  await executeGroup(p.root, directory, 'linux')
  const second = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ios-ci-portable-')))
  t.after(() => fs.rmSync(second, { recursive: true, force: true }))
  fs.cpSync(p.root, second, {
    recursive: true,
    filter: (source) => !path.relative(p.root, source).startsWith('.local')
  })
  const dest = resultsDirectory(second, '.local/ios/tmp/ai-agent/ios-ci-copy', true)
  fs.cpSync(directory, dest, { recursive: true })
  assert.equal(reconcile(second, dest).status, 'passed')
})

test('CI 新 Swift UI 用例必须接入选择器和专项，数据层修改不额外运行页面触摸', (t) => {
  const p = fixture(t),
    r = registry(p.root)
  const data = selectSuites(r, 'change', ['app/src/data/entries/lifecycleService.ts']).map(
    (s) => s.name
  )
  assert.ok(data.includes('native-sqlite'))
  assert.ok(!data.some((name) => name.startsWith('ui-')))
  const dictionaries = selectSuites(r, 'change', [
    'app/src/views/me/dictionaries/DictionaryDetailView.vue'
  ]).map((s) => s.name)
  assert.ok(dictionaries.includes('ui-dictionary-0') && dictionaries.includes('ui-dictionary-7'))
  fs.appendFileSync(
    path.join(p.root, 'app/ios/App/UITests/DictionaryTouchTests.swift'),
    '\nfunc testNewUnregisteredCase() {}\n'
  )
  assert.throws(() => registry(p.root), /新用例未接入/)
})

test('CI 源码摘要包含被 Git 忽略但仍被 App 消费的文件，不把生成资源当源码漂移', (t) => {
  const p = fixture(t)
  fs.appendFileSync(path.join(p.root, '.gitignore'), 'app/src/local.ts\napp/ios/App/App/public/\n')
  p.write('app/src/local.ts', 'before')
  const plan = createPlan(p.root, 'secrets')
  p.write('app/ios/App/App/public/generated.js', 'generated')
  assert.doesNotThrow(() => assertPlan(p.root, plan))
  p.write('app/src/local.ts', 'after')
  assert.throws(() => assertPlan(p.root, plan), /失效/)
})

test('CI 原页面与本地 API 消费接线命中实际领域专项，避免猜测的组件名漏检', (t) => {
  const p = fixture(t),
    r = registry(p.root)
  for (const file of [
    'app/src/components/ExpenseAdjustmentForm.vue',
    'app/src/views/LedgerView.vue',
    'app/src/api/ledgerLifecycle.ts',
    'app/src/api/expenseAdjustments.ts'
  ])
    assert.ok(
      selectSuites(r, 'change', [file]).some((s) => s.name === 'ui-lifecycle'),
      file
    )
  for (const [file, target] of [
    ['app/src/api/incomes.ts', 'ui-entry'],
    ['app/src/api/preferences.ts', 'ui-personal'],
    ['app/src/api/reports.ts', 'ui-reports'],
    ['app/src/api/dictionaries.ts', 'ui-dictionary-0']
  ])
    assert.ok(
      selectSuites(r, 'change', [file]).some((s) => s.name === target),
      file
    )
})

test('CI attempt 独立归档，最新失败不回退旧绿色，重复对账不覆盖原现场', async (t) => {
  const p = fixture(t),
    first = prepare(p, 'secrets', 'first-attempt')
  await executeGroup(p.root, first.directory, 'linux')
  const { archiveGroup } = await import('../lib/ios-ci-run.mjs')
  const base = archiveGroup(p.root, first.directory, 'linux', 1)
  const collected = prepare(p, 'secrets', 'collected')
  fs.cpSync(base, path.join(collected.directory, 'archives'), { recursive: true })
  assert.equal(reconcile(p.root, collected.directory).status, 'passed')
  assert.equal(reconcile(p.root, collected.directory).status, 'passed', '同一归档可只读重复对账')
  const failed = prepare(p, 'secrets', 'second-attempt')
  await assert.rejects(
    executeGroup(p.root, failed.directory, 'linux', {
      command: async () => {
        throw new Error('latest failed')
      }
    })
  )
  archiveGroup(p.root, failed.directory, 'linux', 2)
  const latest = prepare(p, 'secrets', 'latest-collected')
  fs.cpSync(base, path.join(latest.directory, 'archives'), { recursive: true })
  const result = reconcile(p.root, latest.directory)
  assert.equal(result.status, 'incomplete')
  assert.equal(result.suites[0].status, 'failed')
  assert.match(result.suites[0].reason, /latest failed/)
  assert.ok(fs.existsSync(path.join(latest.directory, 'archives/linux-1/secrets/receipt.json')))
  assert.equal(
    reconcile(p.root, collected.directory, 'failure').status,
    'incomplete',
    '无新归档但 job 失败仍不能通过'
  )
})

test('CI 最新 attempt 缺失/错误计划不能回退旧组，机器回执不可用旧源码冒充', async (t) => {
  const p = fixture(t),
    first = prepare(p, 'secrets', 'first')
  await executeGroup(p.root, first.directory, 'linux')
  const { archiveGroup } = await import('../lib/ios-ci-run.mjs')
  const base = archiveGroup(p.root, first.directory, 'linux', 1)
  const second = path.join(base, 'linux-2')
  fs.mkdirSync(second)
  fs.writeFileSync(
    path.join(second, 'attempt.json'),
    JSON.stringify({ group: 'linux', attempt: 2 })
  )
  const target = prepare(p, 'secrets', 'missing-latest')
  fs.cpSync(base, path.join(target.directory, 'archives'), { recursive: true })
  assert.throws(() => reconcile(p.root, target.directory), /ENOENT/)
  fs.writeFileSync(
    path.join(target.directory, 'archives/linux-2/ci-plan.json'),
    JSON.stringify({ id: 'old' })
  )
  assert.throws(() => reconcile(p.root, target.directory), /不是当前计划/)
})

test('CI prepare 固定计划制品名供失败组重跑使用，错误汇总刷新旧绿色而不伪报成功', (t) => {
  const p = fixture(t)
  fs.cpSync(path.join(repository, 'scripts/lib'), path.join(p.root, 'scripts/lib'), {
    recursive: true
  })
  p.write(
    'scripts/ios-ci.mjs',
    fs.readFileSync(path.join(repository, 'scripts/ios-ci.mjs'), 'utf8')
  )
  p.commit()
  const event = p.write('.local/dispatch.json', { inputs: { verification: 'scripts' } }),
    output = p.write('.local/output', '')
  const env = {
    ...process.env,
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_EVENT_PATH: event,
    GITHUB_OUTPUT: output,
    GITHUB_RUN_ID: '1234',
    GITHUB_RUN_ATTEMPT: '1'
  }
  const planned = spawnSync(process.execPath, ['scripts/ios-ci.mjs', 'prepare'], {
    cwd: p.root,
    encoding: 'utf8',
    env
  })
  assert.equal(planned.status, 0, planned.stderr)
  assert.match(fs.readFileSync(output, 'utf8'), /artifact=ios-ci-plan-1/)
  const { directory } = JSON.parse(planned.stdout),
    absolute = path.join(p.root, directory)
  const plan = JSON.parse(fs.readFileSync(path.join(absolute, 'ci-plan.json')))
  plan.suites = []
  fs.writeFileSync(path.join(absolute, 'ci-plan.json'), JSON.stringify(plan))
  fs.writeFileSync(
    path.join(absolute, 'ci-result.json'),
    JSON.stringify({ status: 'passed', completeCandidate: true })
  )
  const result = spawnSync(
    process.execPath,
    ['scripts/ios-ci.mjs', 'result', '--results', directory],
    { cwd: p.root, encoding: 'utf8', env }
  )
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stdout).completeCandidate, false)
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(absolute, 'ci-result.json'))).status,
    'incomplete'
  )
})

test('CI 普通 iOS 工具测试自动接入，同一叶子入口实际执行，不混入旧端测试或跟随链接', (t) => {
  const p = fixture(t)
  p.write(
    'scripts/lib/ios-checks.mjs',
    fs.readFileSync(path.join(repository, 'scripts/lib/ios-checks.mjs'), 'utf8')
  )
  p.write(
    'scripts/tests/ios-added.test.mjs',
    "import {test} from 'node:test';test('auto registered',()=>{});\n"
  )
  p.write('scripts/tests/web-legacy.test.mjs', "throw new Error('old endpoint must not run')\n")
  const result = spawnSync(process.execPath, ['scripts/lib/ios-checks.mjs', 'run-script-tests'], {
    cwd: p.root,
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /auto registered/)
  fs.symlinkSync(
    path.join(p.root, 'scripts/tests/ios-added.test.mjs'),
    path.join(p.root, 'scripts/tests/ios-link.test.mjs')
  )
  const rejected = spawnSync(process.execPath, ['scripts/lib/ios-checks.mjs', 'run-script-tests'], {
    cwd: p.root,
    encoding: 'utf8'
  })
  assert.notEqual(rejected.status, 0)
})
