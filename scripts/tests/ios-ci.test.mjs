import { coverageReport } from '../lib/ios-coverage.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import {
  createPlan,
  digest,
  assertPlan,
  registry,
  selectSuites,
  changedPaths
} from '../lib/ios-ci-plan.mjs'
import { resultsDirectory, executeGroup, reconcile, runCommand } from '../lib/ios-ci-run.mjs'
import { requestedScope, requireJobs, assertNpmSources } from '../lib/ios-ci.mjs'
import { audit, auditDependencies, swiftLock } from '../lib/ios-audit.mjs'
import { assertScriptReport, assertModePhases, requiredModePhases } from '../lib/ios-test-reports.mjs'
import { checkDefinition } from '../lib/ios-checks.mjs'
import { requireEvidence } from '../lib/ios-verification.mjs'
import { processCleanup, finishCleanup } from '../lib/ios-processes.mjs'
import { commandScope } from '../lib/ios-process-scope.mjs'
import { resolveSimctl } from '../lib/ios-simctl.mjs'
import { assertBootStatus } from '../lib/ios-boot-proof.mjs'

const repository = new URL('../../', import.meta.url).pathname

async function waitForProcessState(condition) {
  const until = Date.now() + 3500
  while (!condition()) {
    if (Date.now() >= until) throw new Error('controlled process did not reach expected state')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
function isRunningProcess(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
  return result.status === 0 && !result.stdout.trim().startsWith('Z')
}
function killOwnedGroup(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return
  try { process.kill(-pid, 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e }
}

test('CI 必需阶段逐项缺失、错误阶段、原始日志缺失及无构建成功信号均拒绝，合法模式不误拦', () => {
  for (const mode of ['common', 'ios-build', 'ios-smoke', 'ios-touch']) {
    const phases = requiredModePhases(mode).map(([stage, coverage, basename], i) => ({
      stage, coverage: [coverage], status: 'passed', log: basename ?? 'phase-' + i
    }))
    const logs = new Map(phases.map((p) => [p.log, '** TEST BUILD SUCCEEDED **\nphase completed\n']))
    const raw = (file) => {
      if (!logs.has(file)) throw new Error('missing raw log')
      return logs.get(file)
    }
    assert.doesNotThrow(() => assertModePhases(mode, phases, raw), mode)
    for (const missing of phases) {
      assert.throws(() => assertModePhases(mode, phases.filter((p) => p !== missing), raw), /必需阶段/)
      assert.throws(() => assertModePhases(mode, phases.map((p) => p === missing ? { ...p, stage: 'other' } : p), raw), /必需阶段/)
      const saved = logs.get(missing.log)
      logs.delete(missing.log)
      assert.throws(() => assertModePhases(mode, phases, raw), /missing raw log/)
      logs.set(missing.log, saved)
    }
    assert.throws(() => assertModePhases(mode, phases.map((p, i) => i ? p : { ...p, status: 'running' }), raw), /未完整/)
    const native = phases.find((p) => p.coverage[0].startsWith('native-build/'))
    if (native) {
      logs.set(native.log, 'command started but no build completed')
      assert.throws(() => assertModePhases(mode, phases, raw), /构建缺少实际成功/)
    }
  }
})

test('CI 启动入口与共享消费者选择必要专项，测试文件和局部产品控件不扩大到完整触摸', (t) => {
  const r = registry(fixture(t).root)
  const selected = (file) => selectSuites(r, 'change', [file]).map((s) => s.name)
  for (const file of ['app/index.html', 'app/src/main.ts', 'app/src/stores/bootstrap.ts']) {
    const names = selected(file)
    assert.ok(names.includes('native-sqlite') && names.includes('ui-dictionary-0'), file)
    assert.ok(!names.includes('touch') && !names.includes('ui-reports'), file)
  }
  // 根组件还装配缓存、路由出口、全局撤销和通知；不能将它降为仅首屏启动检查。
  const root = selected('app/src/App.vue')
  for (const suite of ['native-sqlite', 'ui-dictionary-0', 'ui-entry', 'ui-personal',
    'ui-query', 'ui-reports', 'ui-lifecycle']) assert.ok(root.includes(suite), 'App.vue/' + suite)
  assert.ok(!root.includes('touch'))
  for (const name of ['AnchoredDropdown', 'ComboboxField', 'DictionaryCombobox', 'AppStateBlock', 'AppAsyncRegion', 'AppRequestError', 'CachedPageView', 'AppToast', 'FormField', 'AppDrawer']) {
    const names = selected(`app/src/components/${name}.vue`)
    for (const suite of ['ui-entry', 'ui-personal', 'ui-query', 'ui-reports', 'ui-dictionary-0'])
      assert.ok(names.includes(suite), name + '/' + suite)
    assert.ok(!names.includes('touch'))
  }
  for (const name of ['ProductCombobox', 'NameSuggestionCombobox'])
    assert.deepEqual(selected(`app/src/components/${name}.vue`), ['secrets', 'app-common', 'ui-entry', 'ui-personal', 'scale-10000', 'scale-100000'])
  assert.deepEqual(selected('app/src/components/DictionaryFilterPicker.vue'), ['secrets', 'app-common', 'ui-query', 'ui-reports', 'ui-report-dimensions', 'scale-10000', 'scale-100000'])
  assert.deepEqual(selected('app/src/components/ComboboxField.spec.ts'), ['secrets', 'app-common'])
  assert.deepEqual(selected('app/src/stores/bootstrap.spec.ts'), ['secrets', 'app-common'])
})

test('T14 单测变更不触发原生交互专项，实现和混合变更仍选中',t => {
  const r = registry(fixture(t).root)
  const selected = files => selectSuites(r,'change',files).map(s => s.name)
  for (const file of ['app/src/platform/textScale','app/src/platform/appearance','app/src/composables/useKeyboardViewport']) {
    assert.deepEqual(selected([file+'.spec.ts']),['secrets','app-common'],file)
    assert.ok(selected([file+'.ts']).includes('ui-ios-interaction'),file)
    assert.ok(selected([file+'.spec.ts',file+'.ts']).includes('ui-ios-interaction'),file)
  }
})

test('CI 脚本报告拒绝 TODO、非法/重复/错误平台跳过及计数缺口，保留登记的 Linux 缺口', (t) => {
  const p = fixture(t), allowed = registry(p.root).scriptSkips.linux[0]
  const report = (names = [], todo = 0) =>
    names.map((name, i) => `ok ${i + 2} - ${name} # SKIP`).join('\n') +
    `\n# tests ${1 + names.length + todo}\n# pass 1\n# fail 0\n# cancelled 0\n# skipped ${names.length}\n# todo ${todo}\n`
  for (const platform of ['linux', 'darwin']) {
    assert.doesNotThrow(() => assertScriptReport(p.root, report(), platform))
    assert.throws(() => assertScriptReport(p.root, report([], 1), platform), /TODO/)
    assert.throws(() => assertScriptReport(p.root, report(['unregistered']), platform), /跳过/)
    assert.throws(() => assertScriptReport(p.root, report([allowed, allowed]), platform), /跳过/)
    assert.throws(() => assertScriptReport(p.root, report().replace('# tests 1', '# tests 2'), platform), /计数/)
    assert.throws(() => assertScriptReport(p.root, report() + '# pass 1\n', platform), /计数/)
  }
  assert.doesNotThrow(() => assertScriptReport(p.root, report([allowed]), 'linux'))
  assert.throws(() => assertScriptReport(p.root, report([allowed]), 'darwin'), /跳过/)
  assert.throws(() => assertScriptReport(p.root, report([allowed]).replace(/^ok .+\n/m, ''), 'linux'), /跳过/)
  const policy = JSON.parse(fs.readFileSync(path.join(p.root, 'config/ios-ci.json')))
  policy.scriptSkips.linux.push(allowed)
  p.write('config/ios-ci.json', policy)
  assert.throws(() => registry(p.root), /跳过登记/)
})

test('CI 同源局部脚本回执也核验实际报告，TODO 和非法跳过不能成为完整验收的前置证据', (t) => {
  const p = fixture(t)
  p.write('scripts/tests/ios-only.test.mjs', "import {test} from 'node:test';test('actual',()=>{});\n")
  const run = path.join(p.root, '.local/ios/tmp/ai-agent/ios-check-proof')
  const definition = checkDefinition(p.root, run, 'script-tests')
  const hash = 'caller-verified-input'
  p.write(path.relative(p.root, path.join(run, 'result.json')), {
    scope: 'partial', status: 'passed', check: 'script-tests', inputHash: hash,
    coverage: definition.coverage, options: {}, completedAt: Date.now(),
    command: { program: path.basename(definition.program), args: definition.args, exit: 0 }
  })
  const passed = '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
  const log = p.write(path.relative(p.root, path.join(run, 'check.log')), passed)
  assert.doesNotThrow(() => requireEvidence(p.root, run, hash))
  fs.writeFileSync(log, passed.replace('# tests 1', '# tests 2').replace('# todo 0', '# todo 1'))
  assert.throws(() => requireEvidence(p.root, run, hash), /TODO/)
  fs.writeFileSync(log, 'ok 2 - unregistered # SKIP\n' + passed.replace('# tests 1', '# tests 2').replace('# skipped 0', '# skipped 1'))
  assert.throws(() => requireEvidence(p.root, run, hash), /跳过/)
})

test('CI Linux 登记的 macOS 专用跳过与真实 TAP 用例名称一致，不误拦合法平台报告', (t) => {
  const p = fixture(t), names = registry(p.root).scriptSkips.linux
  const override = p.write('.local/linux-platform.mjs', "Object.defineProperty(process,'platform',{value:'linux'});\n")
  const sentinel = p.write('.local/sentinel.test.mjs', "import {test} from 'node:test';test('linux sentinel',()=>{});\n")
  const pattern = [...names, 'linux sentinel'].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  // 只读取并跳过已登记的 Mac 用例，外加一条纯 Node 哨兵；不执行其原生 CLI 测试体。
  const result = spawnSync(process.execPath, ['--import', override, '--test', '--test-reporter=tap',
    '--test-name-pattern', pattern, path.join(repository, 'scripts/tests/ios-verification.test.mjs'), sentinel],
  { encoding: 'utf8', env })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp('^# skipped ' + names.length + '$', 'm'))
  assert.doesNotThrow(() => assertScriptReport(p.root, result.stdout, 'linux'))
})
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

function environmentSession(p,action='close') {
    const id='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222'
    const session=path.join(p.root,'.local/ios/tmp/ai-agent/ios-debug-fixture')
    const context=p.write('.local/ios/tmp/ai-agent/ios-debug-fixture/test-context.json',{
      kind:'ios-debug',schema:1,state:action==='close'?'closed':'open',appId:'com.mybill.offline',simulatorId:id,runId,name:'我的账单调试-'+runId})
    fs.chmodSync(context,0o600)
    const now=Date.now(),r={schema:3,startupMode:'bootstatus-b',tool:{program:'xcrun',prefix:['simctl'],mode:'sdk-wrapper'},scope:'environment',status:'passed',deviceState:'Booted',simulatorId:id,runId,
      initialDevice:{udid:id,name:'我的账单调试-'+runId,state:'Shutdown',isAvailable:true,deviceTypeIdentifier:'com.apple.CoreSimulator.SimDeviceType.iPhone-14-Pro-Max'},
      environment:JSON.stringify({sdk:'27.0',xcode:'Xcode 27.0',runtime:'TEST'}),budgetMs:120000,startedAt:now-5,completedAt:now,elapsedMs:5,commands:[
        {stage:'verify-device',program:'xcrun',status:'passed',pid:200501,startedAt:now-5,completedAt:now-2},
        {stage:'boot-ready',program:'xcrun',status:'passed',pid:200502,startedAt:now-2,completedAt:now}]}
    p.write('.local/ios/tmp/ai-agent/ios-debug-fixture/boot-readiness.json',r)
    const bootLog='Monitoring boot status for owned ('+id+').\nStatus=4294967295, isTerminal=YES, Elapsed=00:01.\n\tFinished\n'
    p.write('.local/ios/tmp/ai-agent/ios-debug-fixture/boot-status.log',bootLog)
    p.write('.local/ios/tmp/ai-agent/ios-debug-fixture/boot-lifecycle.json',{
      schema:1,action,status:'passed',runId,simulatorId:id,budgetMs:120000,startedAt:now,completedAt:now,durationMs:0,
      commands:(action==='close'?['delete']:['shutdown']).map(operation=>({operation,status:'passed',exit:0,pid:200503,program:'xcrun',startedAt:now,completedAt:now}))})
    return {session,id,runId,bootLog}
}

test('CI 新会话先预检再编译，失败不执行套件，成功后只关闭同一会话', async t => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value:'darwin' })
  try {
    for (const booted of [false,true]) {
      const p = fixture(t), {directory} = prepare(p,'app', 'boot-'+booted)
      const session = path.join(p.root,'.local/ios/tmp/ai-agent/ios-debug-controlled')
      const calls = []
      await assert.rejects(executeGroup(p.root,directory,'macos',{command:async (_root,_program,args) => {
        calls.push(args)
        if (args[2]==='create') {
          assert.deepEqual(args,['scripts/ios-app.sh','debug','create','--boot','--after-boot','suspend'])
          if (!booted) throw new Error('CONTROLLED_BOOT_FAILURE')
          return 'SESSION='+session+'\n'
        }
        if (args[2]==='suspend') {
          assert.deepEqual(args,['scripts/ios-app.sh','debug','suspend','--session',session]);return ''
        }
        if (args[2]==='close') {
          assert.deepEqual(args,['scripts/ios-app.sh','debug','close','--session',session])
          return ''
        }
        assert.ok(booted)
        throw new Error('CONTROLLED_AFTER_BOOT')
      }}), booted ? /CONTROLLED_AFTER_BOOT/ : /CONTROLLED_BOOT_FAILURE/)
      assert.equal(calls.length,booted?3:1)
      if (booted) {
        assert.deepEqual(calls[1],['scripts/ios-app.sh','ios-build'])
      }
      const result=JSON.parse(fs.readFileSync(path.join(directory,'group-macos.json')))
      assert.equal(result.status,'failed')
      assert.match(result.error,booted?/CONTROLLED_AFTER_BOOT/:/CONTROLLED_BOOT_FAILURE/)
      if (!booted) assert.equal(fs.existsSync(path.join(directory,'native-build')),false)
    }
  } finally {Object.defineProperty(process,'platform',original)}
})

test('CI 启动环境专项只运行新会话启动及关闭，拒绝旧回执和错误来源且不冒充 App 验收', async t => {
  const original=Object.getOwnPropertyDescriptor(process,'platform')
  Object.defineProperty(process,'platform',{value:'darwin'})
  try {
    const p=fixture(t), {directory}=prepare(p,'simulator-boot','environment')
    const {session,id,runId,bootLog}=environmentSession(p),calls=[]
    const command=async(_root,_program,args)=>{calls.push(args);return args[2]==='create'?'SESSION='+session+'\n':''}
    await executeGroup(p.root,directory,'macos',{command})
    assert.deepEqual(calls,[['scripts/ios-app.sh','debug','create','--boot','--after-boot','close']])
    assert.equal(reconcile(p.root,directory).status,'passed')
    assert.equal(reconcile(p.root,directory).completeCandidate,false)
    const receiptFile=path.join(directory,'simulator-boot/receipt.json'),reportFile=path.join(directory,'simulator-boot/environment.json')
    const originalReport=JSON.parse(fs.readFileSync(reportFile))
    for (const change of [v=>delete v.lifecycle,v=>v.lifecycle.status='running',v=>v.lifecycle.action='unknown',v=>{v.lifecycle.action='suspend';v.lifecycle.commands[0].operation='shutdown'},v=>v.lifecycle.commands.pop(),v=>v.lifecycle.simulatorId=runId,v=>v.lifecycle.commands[0].pid=0,v=>v.lifecycle.commands[0].program='wrong',v=>v.lifecycle.durationMs=120001,v=>v.lifecycle.startedAt=v.readiness.startedAt-1,v=>v.source.commit='0'.repeat(40),v=>v.readiness.status='failed',v=>v.readiness.deviceState='Shutdown',
      v=>delete v.readiness.initialDevice,v=>v.readiness.initialDevice.state='Booted',
      v=>v.readiness.initialDevice.udid=runId,v=>v.readiness.initialDevice.name='other',v=>delete v.readiness.tool,v=>v.readiness.commands[1].program='other-tool',v=>delete v.readiness.schema,v=>v.readiness.startupMode='split-boot',
      v=>v.readiness.commands.pop(),v=>v.readiness.commands[0].status='running',v=>v.readiness.commands[1].pid=0,
      v=>v.readiness.commands[1].startedAt=v.readiness.startedAt-1,
      v=>v.readiness.elapsedMs=120001,v=>v.readiness.scope='partial',v=>v.readiness.environment='{}',v=>v.readiness.completedAt=Date.now()+60000]) {
      const value=structuredClone(originalReport);change(value);fs.writeFileSync(reportFile,JSON.stringify(value))
      const receipt=JSON.parse(fs.readFileSync(receiptFile));receipt.reports.find(x=>x.path==='environment.json').hash=digest(fs.readFileSync(reportFile))
      fs.writeFileSync(receiptFile,JSON.stringify(receipt))
      assert.equal(reconcile(p.root,directory).status,'incomplete')
    }
    fs.writeFileSync(reportFile,JSON.stringify(originalReport))
    const rawLog=path.join(directory,'simulator-boot/boot-status.log')
    for(const text of ['Monitoring boot status for owned ('+id+').\nStatus=0, isTerminal=NO\n',bootLog.replace(id,runId),bootLog]) {
      fs.writeFileSync(rawLog,text)
      const receipt=JSON.parse(fs.readFileSync(receiptFile))
      for(const name of ['environment.json','boot-status.log'])receipt.reports.find(x=>x.path===name).hash=digest(fs.readFileSync(path.join(directory,'simulator-boot',name)))
      fs.writeFileSync(receiptFile,JSON.stringify(receipt))
      assert.equal(reconcile(p.root,directory).status,text===bootLog?'passed':'incomplete')
    }
    const selected=selectSuites(registry(p.root),'change',['scripts/lib/ios-processes.mjs'],{execution:'local'}).map(x=>x.name)
    assert.deepEqual(selected,['secrets','scripts','simulator-boot','scripts-macos'])
    assert.equal(selected.filter(name=>registry(p.root).suites[name].runner==='macos')[0],'simulator-boot','冷启动预检必须先于工具压力回归')
    for(const file of ['scripts/lib/ios-process-launch.sh','scripts/lib/ios-host-diagnostics.py','scripts/lib/ios-app-full.sh','scripts/lib/ios-simctl.mjs','scripts/lib/ios-boot-proof.mjs','scripts/lib/ios-ci-run.mjs'])
      assert.ok(selectSuites(registry(p.root),'change',[file],{execution:'local'}).some(x=>x.name==='simulator-boot'),file)
    assert.ok(!selectSuites(registry(p.root),'pull-request',['scripts/tests/ios-ci.test.mjs']).some(x=>x.name==='simulator-boot'))
    const borrowed=prepare(p,'simulator-boot','borrowed')
    await assert.rejects(executeGroup(p.root,borrowed.directory,'macos',{command,session}),/不能复用旧启动回执/)
    assert.equal(calls.length,1,'拒绝旧会话前不启动、关闭或暂停该设备')
  } finally {Object.defineProperty(process,'platform',original)}
})

function processFixture(t) {
  const p = fixture(t)
  fs.cpSync(path.join(repository, 'scripts/lib'), path.join(p.root, 'scripts/lib'), { recursive: true })
  p.write('scripts/ios-app.mjs', fs.readFileSync(path.join(repository, 'scripts/ios-app.mjs'), 'utf8'))
  p.write('app/native-tests/scenarios.json', fs.readFileSync(path.join(repository, 'app/native-tests/scenarios.json'), 'utf8'))
  return p
}

test('CI 规划在安装前拒绝私有镜像、HTTP 与带凭据下载源，官方锁项和别名不误拦', t => {
  const good = 'https://registry.npmjs.org/example/-/example-1.0.0.tgz'
  for (const resolved of [good.replace('https:', 'http:'), good.replace('registry.npmjs.org', 'private.invalid'),
    good.replace('https://', 'https://user:password@'), good + '?token=secret', good + '#fragment', 'not-a-url']) {
    assert.throws(() => assertNpmSources({ packages: { 'node_modules/example': { resolved } } }), /官方 HTTPS/)
  }
  assert.doesNotThrow(() => assertNpmSources({ packages: {
    '': { name: 'fixture' }, 'node_modules/alias': { name: 'example', resolved: good },
    'node_modules/@scope/example': { resolved: 'https://registry.npmjs.org/@scope/example/-/example-1.0.0.tgz' }
  } }))
  const p = fixture(t)
  p.write('app/package-lock.json', { packages: { 'node_modules/example': { resolved: 'http://private.invalid/example.tgz' } } })
  assert.throws(() => createPlan(p.root, 'scripts'), /官方 HTTPS/, 'prepare 的共用规划器在安装前拒绝')
})

test('CI 登记复用现有执行器与专项；PR 自动、固定范围和非法请求拒绝', (t) => {
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
  for (const profile of ['scripts','common','dependency-audit']) {
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
  const noSecrets = structuredClone(r)
  noSecrets.changeBase = ['scripts']
  p.write('config/ios-ci.json', noSecrets)
  assert.throws(() => registry(p.root), /变更范围缺少必需 secret/)
  r.rules[0].suites.push('unknown')
  p.write('config/ios-ci.json', r)
  assert.throws(() => registry(p.root), /未知/)
})

test('PR 计划使用实际 head 和共同祖先，按变更专项且完整触摸和容量仅按需', (t) => {
  const p = fixture(t)
  p.git('checkout', '-qb', 'feature')
  p.write('app/src/views/LedgerView.vue', 'feature')
  const head = p.commit()
  p.git('checkout', '-qb', 'target', p.base)
  p.write('app/src/views/DictionaryView.vue', 'base-only')
  const base = p.commit()
  p.git('checkout', '-q', 'feature')
  const selected = requestedScope('pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } })
  assert.deepEqual(selected, { profile: 'pull-request', base, head })
  const plan = createPlan(p.root, selected.profile, selected)
  assert.deepEqual(plan.range, { base, head, mergeBase: p.base })
  assert.deepEqual(plan.files, ['app/src/views/LedgerView.vue'])
  assert.ok(plan.localRequired.some(s => s.name === 'ui-query-input'))
  assert.ok(!plan.suites.some(s=>s.kind==='ui'))
  assert.ok(plan.suites.some(s => s.name === 'app-common'))
  assert.ok(plan.deferred.some(s => s.name === 'scale-10000'))
  assert.ok(plan.deferred.some(s => s.name === 'scale-100000'))
  assert.ok(plan.suites.every(s => !registry(p.root).onDemandSuites.includes(s.name)))
  assert.doesNotThrow(() => assertPlan(p.root, plan))
  const tampered = structuredClone(plan)
  tampered.deferred = []
  assert.throws(() => assertPlan(p.root, tampered), /失效/)
  assert.throws(() => createPlan(p.root, selected.profile, { base, head: base }), /当前检出/)
  for (const sha of [undefined, '', '0'.repeat(40), 'not-a-sha'])
    assert.throws(() => requestedScope('pull_request', { pull_request: { base: { sha }, head: { sha: head } } }), /完整/)
  const r = registry(p.root)
  assert.deepEqual(selectSuites(r, 'pull-request', ['agent-works/note.md']).map(s => s.name), ['secrets'])
  const scripts = selectSuites(r, 'pull-request', ['scripts/lib/ios-ci.mjs']).map(s => s.name)
  assert.deepEqual(scripts, ['secrets', 'scripts', 'scripts-macos'])
  const change = createPlan(p.root, 'change', { base: p.base, head })
  assert.ok(change.deferred.some(s => s.name === 'scale-10000'), '日常本地 change 将容量留给明确请求/最终验收')
  assert.ok(change.suites.some(s=>s.name==='ui-query-input'),'本地按变更仍选择必要 UI 专项')
  assert.ok(selectSuites(r, 'final').some(s => s.name === 'touch'))
  r.onDemandSuites.push('app-common')
  p.write('config/ios-ci.json', r)
  assert.throws(() => registry(p.root), /仅包含/)
})

test('CI common result 拒绝失败、取消、跳过和缺失作业，真实成功报告不能遮蔽作业失败', async (t) => {
  const p = fixture(t), { directory } = prepare(p)
  await executeGroup(p.root, directory, 'linux')
  for (const status of ['failure', 'cancelled', 'skipped', 'running', '', undefined]) {
    for (const [plan, checks] of [[status, 'success'], ['success', status]]) {
      assert.throws(() => requireJobs(plan, checks), /未成功/)
      const result = reconcile(p.root, directory, checks ?? 'missing', plan ?? 'missing')
      assert.equal(result.status, 'incomplete', `${plan}/${checks}`)
      assert.equal(result.completeCandidate, false)
    }
  }
  assert.doesNotThrow(() => requireJobs('success', 'success'))
  assert.equal(reconcile(p.root, directory, 'success', 'success').status, 'passed')
  assert.equal(reconcile(p.root, directory).status, 'passed', '本地不要求 GitHub 环境')
  for (const [plan, checks, exit] of [['failure','success',1],['success','cancelled',1],['success','skipped',1],['','',1],['success','success',0]]) {
    const run = spawnSync(process.execPath, [path.join(repository, 'scripts/ios-ci.mjs'), 'require-jobs'], {
      encoding: 'utf8', env: { ...process.env, IOS_CI_PLAN_STATUS: plan, IOS_CI_CHECKS_STATUS: checks }
    })
    assert.equal(run.status, exit, run.stderr)
  }
})

test('PR prepare 真实入口绑定事件源码，远端 result 缺少作业状态不能回退本地成功', async (t) => {
  const p = processFixture(t)
  p.write('scripts/ios-ci.mjs', fs.readFileSync(path.join(repository, 'scripts/ios-ci.mjs'), 'utf8'))
  const base = p.commit()
  p.write('scripts/pr-example.mjs', '// changed')
  const head = p.commit()
  const event = p.write('.local/ios/event.json', { pull_request: { base: { sha: base }, head: { sha: head } } })
  const output = p.write('.local/ios/output', '')
  const env = { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event,
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_OUTPUT: output }
  const cli = (args, extra = {}) => spawnSync(process.execPath, ['scripts/ios-ci.mjs', ...args], {
    cwd: p.root, encoding: 'utf8', env: { ...env, ...extra }
  })
  const prepared = cli(['prepare'])
  assert.equal(prepared.status, 0, prepared.stderr)
  const generated = JSON.parse(prepared.stdout)
  const plan = JSON.parse(fs.readFileSync(path.join(p.root, generated.directory, 'ci-plan.json')))
  assert.equal(plan.profile, 'pull-request')
  assert.equal(plan.source.commit, head)
  assert.deepEqual(plan.files, ['scripts/pr-example.mjs'])
  assert.match(fs.readFileSync(output, 'utf8'), /artifact=ios-ci-plan-2/)
  const { directory } = prepare(p, 'secrets', 'remote-status',{execution:'remote'})
  await executeGroup(p.root, directory, 'linux')
  for (const status of ['', undefined]) {
    const missing = cli(['result', '--results', directory], {
      GITHUB_ACTIONS: 'true', IOS_CI_PLAN_STATUS: status, IOS_CI_CHECKS_STATUS: 'success'
    })
    assert.equal(missing.status, 1, missing.stderr)
    assert.equal(JSON.parse(missing.stdout).status, 'incomplete')
  }
  const passed = cli(['result', '--results', directory], {
    GITHUB_ACTIONS: 'true', IOS_CI_PLAN_STATUS: 'success', IOS_CI_CHECKS_STATUS: 'success'
  })
  assert.equal(passed.status, 0, passed.stderr)
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

test('CI 工作流 PR 自动、通用门禁始终对账，手动结果隔离且不自动完整验收或旧端服务', () => {
  const workflow = fs.readFileSync(
    path.join(repository, '.github/workflows/offline-ios.yml'),
    'utf8'
  )
  const trigger = workflow.slice(workflow.indexOf('on:\n'), workflow.indexOf('\npermissions:'))
  assert.match(trigger, /push:\n    tags:/)
  assert.match(trigger, /pull_request:\n    types: \[opened, synchronize, reopened, ready_for_review, edited\]/)
  assert.doesNotMatch(trigger, /pull_request_target:|branches:|schedule:|paths:/)
  const result = workflow.slice(workflow.indexOf('\n  result:'))
  assert.match(result, /github.event_name == 'pull_request' && 'CI common result' \|\| format\('CI suite/)
  assert.match(result, /\n    if: always\(\)\n    needs: \[plan, checks\]/)
  assert.match(result, /IOS_CI_PLAN_STATUS: \$\{\{ needs.plan.result \}\}/)
  assert.match(result, /IOS_CI_CHECKS_STATUS: \$\{\{ needs.checks.result \}\}/)
  assert.match(result, /name: Require every selected job\n        if: always\(\)/)
  assert.match(result, /run: npm run ci:ios-app -- require-jobs/)
  assert.equal(workflow.match(/ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/g).length, 3)
  assert.equal(workflow.match(/persist-credentials: false/g).length, 3)
  assert.match(workflow, /matrix: \$\{\{ fromJSON\(needs.plan.outputs.matrix\) \}\}/)
  assert.match(workflow, /DEVELOPER_DIR: \$\{\{ matrix.group == 'macos' && '\/Applications\/Xcode_27\.app\/Contents\/Developer' \|\| '' \}\}/)
  assert.match(workflow, /name: Verify pinned Apple toolchain\n        if: matrix.group == 'macos'/)
  assert.match(workflow, /run --results "\$IOS_CI_RESULTS" --group "\$IOS_CI_GROUP"/)
  assert.match(workflow, /result --results "\$IOS_CI_RESULTS"/)
  assert.doesNotMatch(workflow, /app-baseline-v1:|ios-ci\/final|ios-ci\/scale-|ios-ci\/recovery/)
  assert.match(trigger, /- common/)
  assert.doesNotMatch(trigger, /- final|- recovery|- scale-/)
  assert.match(workflow, /include-hidden-files: true/)
  assert.match(workflow, /\.local\/ios\/tmp\/ai-agent\/ios-check-\*\/check\.log/)
  assert.match(workflow, /\.local\/ios\/tmp\/ai-agent\/native-\*\/\*\.log/)
  assert.match(workflow, /\.local\/ios\/tmp\/ai-agent\/native-\*\/app-tests\.json/)
  assert.match(workflow, /\.local\/ios\/tmp\/ai-agent\/ios-debug-\*\/boot-\*\.json/)
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

test('CI 清理宽限与执行预算独立，慢命令正常完成且内部参数不能延长清理预算', async (t) => {
  const p = fixture(t), log = path.join(p.root, 'slow-normal.log')
  const output = await runCommand(p.root, process.execPath,
    ['-e', "setTimeout(()=>console.log('SLOW_NORMAL_COMPLETED'),650)"], log, 10000,
    { cleanupGraceMs: 500 })
  assert.equal(output, 'SLOW_NORMAL_COMPLETED\n')
  for (const [i, cleanupGraceMs] of [-1, 10001, Infinity, '500'].entries()) {
    const rejectedLog = path.join(p.root, `rejected-${i}.log`)
    await assert.rejects(runCommand(p.root, process.execPath, [], rejectedLog, 10000,
      { cleanupGraceMs }), /清理宽限/)
    assert.equal(fs.existsSync(rejectedLog), false, '非法参数在启动或创建日志前拒绝')
  }
})

test('CI 超时及取消后组长提前退出，忽略 TERM 的后代仍被清理且正常完成不误杀', { timeout: 15000 }, async (t) => {
  for (const mode of ['timeout', 'SIGTERM']) {
    await t.test(mode, async (t) => {
      const p = fixture(t), ready = path.join(p.root, 'child.pid'), leaderFile = path.join(p.root, 'leader.pid')
      const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`
      const leader = `require('node:fs').writeFileSync(${JSON.stringify(leaderFile)},String(process.pid));require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000)`
      const workerSource = `import {runCommand} from ${JSON.stringify(new URL('../lib/ios-ci-run.mjs', import.meta.url).href)};try{await runCommand(${JSON.stringify(p.root)},process.execPath,['-e',${JSON.stringify(leader)}],${JSON.stringify(path.join(p.root, 'timeout.log'))},${mode === 'timeout' ? 900 : 10000});process.exitCode=2}catch{process.exitCode=1}`
      const workerFile = p.write('worker.mjs', workerSource)
      const worker = spawn(process.execPath, [workerFile], { stdio: 'ignore' })
      const ended = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('close', resolve) })
      const cleanup = () => {
        worker.kill('SIGKILL')
        if (fs.existsSync(leaderFile)) {
          try { process.kill(-Number(fs.readFileSync(leaderFile)), 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e }
        }
      }
      try {
        await waitForProcessState(() => fs.existsSync(ready))
        const child = Number(fs.readFileSync(ready))
        assert.ok(isRunningProcess(child), '后代实际进入忽略 TERM 的等待')
        if (mode === 'SIGTERM') worker.kill('SIGTERM')
        assert.equal(await ended, 1)
        await waitForProcessState(() => !isRunningProcess(child))
      } finally {
        cleanup()
        await ended
      }
    })
  }
  const p = fixture(t), log = path.join(p.root, 'normal.log')
  assert.equal(await runCommand(p.root, process.execPath, ['-e', "console.log('NORMAL_COMPLETED')"], log, 1000), 'NORMAL_COMPLETED\n')
})

test('CI 真实内外层命令统一清理嵌套独立进程组，超时/取消及外层先强杀不遗留、不误杀其他任务',
  { timeout: 20000 }, async (t) => {
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' })
    const sentinelEnded = new Promise((resolve) => sentinel.once('close', resolve))
    try {
      for (const mode of ['outer-timeout', 'outer-SIGTERM', 'outer-SIGINT', 'outer-force',
        'inner-timeout', 'inner-SIGTERM', 'inner-SIGINT']) {
        await t.test(mode, async (t) => {
          const p = processFixture(t), ready = path.join(p.root, 'child.pid'), leaderFile = path.join(p.root, 'leader.json')
          const descendant = `process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`
          p.write('leader.cjs', `require('node:fs').writeFileSync(${JSON.stringify(leaderFile)},JSON.stringify({pid:process.pid,parent:process.ppid}));${mode === 'outer-force' ? "process.on('SIGTERM',()=>{});" : ''}require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000)`)
          // 使用真实 command/信号处理。外层 500ms 留出快照时间，仍先于内层 10s 强杀；预检 1100ms 不属于清理宽限。
          p.write('scripts/lib/ios-app-full.sh',
            (mode === 'outer-force' ? "node -e 'setTimeout(()=>{},1100)'\n" : '') + 'exec node leader.cjs\n')
          const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH }
          delete env.NODE_TEST_CONTEXT
          const direct = mode.startsWith('inner-')
          let args
          if (direct) {
            const clock = p.write('.local/short-check-clock.mjs', `const original=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>original(fn,ms>60000?900:ms,...args);\n`)
            args = [...(mode === 'inner-timeout' ? ['--import', clock] : []), 'scripts/ios-app.mjs', 'common']
          } else {
            const worker = p.write('worker.mjs', `import {runCommand} from ${JSON.stringify(new URL('../lib/ios-ci-run.mjs', import.meta.url).href)};try{await runCommand(${JSON.stringify(p.root)},process.execPath,['scripts/ios-app.mjs','common'],${JSON.stringify(path.join(p.root, 'outer.log'))},${mode.endsWith('timeout') ? 900 : 10000},${mode === 'outer-force' ? '{cleanupGraceMs:500}' : '{}'});process.exitCode=2}catch{process.exitCode=1}`)
            args = [worker]
          }
          const worker = spawn(process.execPath, args, { cwd: p.root, env, detached: true, stdio: 'ignore' })
          const ended = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('close', resolve) })
          try {
            await waitForProcessState(() => fs.existsSync(ready))
            const child = Number(fs.readFileSync(ready)), leader = JSON.parse(fs.readFileSync(leaderFile))
            assert.ok(isRunningProcess(child),'取消前子进程已退出；worker exit='+worker.exitCode+'；outer='+ (fs.existsSync(path.join(p.root,'outer.log'))?fs.readFileSync(path.join(p.root,'outer.log'),'utf8').slice(-4000):'no log'))
            assert.equal(Number(spawnSync('ps', ['-p', String(child), '-o', 'pgid='], { encoding: 'utf8' }).stdout.trim()), child,
              '后代实际另起进程组')
            if (mode.endsWith('SIGTERM') || mode === 'outer-force') worker.kill('SIGTERM')
            if (mode.endsWith('SIGINT')) worker.kill('SIGINT')
            assert.equal(await ended, direct && mode.endsWith('SIGTERM') ? 143 : direct && mode.endsWith('SIGINT') ? 130 : 1)
            await waitForProcessState(() => !isRunningProcess(child))
            assert.ok(isRunningProcess(sentinel.pid), '其他任务未被清理')
            const base = path.join(p.root, '.local/ios/tmp/ai-agent')
            const results = fs.readdirSync(base).filter((name) => /^ios-(?:command|invocation)-/.test(name))
              .map((name) => path.join(base, name, 'result.json')).filter((f) => fs.existsSync(f))
            assert.ok(results.length)
            for (const file of results) assert.notEqual(JSON.parse(fs.readFileSync(file)).status, 'passed')
          } finally {
            worker.kill('SIGKILL')
            if (fs.existsSync(ready)) killOwnedGroup(Number(fs.readFileSync(ready)))
            if (fs.existsSync(leaderFile)) {
              const leader = JSON.parse(fs.readFileSync(leaderFile))
              killOwnedGroup(leader.pid)
              killOwnedGroup(leader.parent)
            }
            killOwnedGroup(worker.pid)
            await ended
          }
        })
      }
    } finally {
      killOwnedGroup(sentinel.pid)
      await sentinelEnded
    }
  })

test('CI 正常内外层命令不扫描进程树、不误拦成功或影响其他任务', async (t) => {
  const p = processFixture(t), marker = path.join(p.root, 'unexpected-ps')
  const ps = p.write('bin/ps', `#!/bin/sh\ntouch '${marker}'\nexit 1\n`)
  fs.chmodSync(ps, 0o755)
  p.write('scripts/lib/ios-app-full.sh', "printf 'NESTED_NORMAL_COMPLETED\\n'\n")
  const envPath = path.join(p.root, 'bin') + path.delimiter + process.env.PATH
  const output = await runCommand(p.root, '/usr/bin/env', ['PATH=' + envPath, process.execPath,
    'scripts/ios-app.mjs', 'common'], path.join(p.root, 'normal.log'), 3000)
  assert.match(output, /NESTED_NORMAL_COMPLETED/)
  assert.match(output, /^CI_RESULT=/m)
  assert.equal(fs.existsSync(marker), false)
})

test('CI 成功退出的组长遗留同组后台成员时仍关闭自己的分支，保留成功退出结果', async (t) => {
  const p = fixture(t), pidFile = path.join(p.root, 'background.pid')
  const source = `const fs=require('node:fs'),{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));c.unref();console.log('SUCCESSFUL_OWNER_EXIT')`
  try {
    const output = await runCommand(p.root, process.execPath, ['-e', source], path.join(p.root, 'success.log'), 2000)
    assert.equal(output, 'SUCCESSFUL_OWNER_EXIT\n')
    await waitForProcessState(() => !isRunningProcess(Number(fs.readFileSync(pidFile))))
  } finally {
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile))
      try { process.kill(pid, 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e }
    }
  }
})

test('CI 取消后新补偿组仍归外层清理，登记前后中断不放行工具，保持预算与其他任务保护',
  // 包含真实执行超时和受控慢预检，测试容器预算不改变执行器的生产预算。
  { timeout: 30000 }, async (t) => {
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' })
    const sentinelEnded = new Promise((resolve) => sentinel.once('close', resolve))
    try {
      for (const mode of ['timeout', 'SIGTERM', 'slow-preflight', 'seal-failure',
        'before-publish', 'after-publish', 'bind-failure']) {
        await t.test(mode, async (t) => {
          const p = processFixture(t), initial = path.join(p.root, 'initial.json'), late = path.join(p.root, 'late.pid')
          const gate = path.join(p.root, 'gate.json'), sealFailure = path.join(p.root, 'seal-failure.json')
          const workerResult = path.join(p.root, 'worker-result.json')
          const executionBudget = mode === 'timeout' ? 5000 : 10000
          const xcrun = p.write('bin/xcrun', `#!${process.execPath}
const fs=require('node:fs'),a=process.argv.slice(2);
if(a[0]==='--find')console.log('/controlled/sdk/usr/bin/simctl');
else if(a[0]==='--sdk'){${mode === 'slow-preflight' ? 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,650);' : ''}console.log('27.0')}
else if(a[2]==='runtimes')console.log(JSON.stringify({runtimes:[{identifier:'com.apple.CoreSimulator.SimRuntime.iOS-27-0',isAvailable:true,buildversion:'TEST'}]}));
else if(a[1]==='create'){fs.writeFileSync(${JSON.stringify(initial)},JSON.stringify({pid:process.pid,parent:process.ppid}));setInterval(()=>{},1000)}
else if(a[2]==='devices'){process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(late)},String(process.pid));setInterval(()=>{},1000)}
else process.exit(2);
`)
          fs.chmodSync(xcrun, 0o755)
          const xcode = p.write('bin/xcodebuild', '#!/bin/sh\nprintf "Xcode 27.0\\n"\n')
          fs.chmodSync(xcode, 0o755)
          // 平台及工具链都由夹具提供；Linux 也执行相同控制器回归，不把它算作原生 SDK 验收。
          const platform = p.write('.local/controlled-platform.mjs', "Object.defineProperty(process,'platform',{value:'darwin'});\n")
          let preload
          if (mode.endsWith('publish') || mode === 'bind-failure') {
            preload = p.write('.local/publish-interruption.mjs', `
import fs from 'node:fs';const original=fs.renameSync;
fs.renameSync=(from,to)=>{
  if(String(from).includes('/ios-process-') && fs.existsSync(${JSON.stringify(initial)})){
    const r=JSON.parse(fs.readFileSync(from));
    if(r.state==='running' && r.pid){
      fs.writeFileSync(${JSON.stringify(gate)},JSON.stringify({pid:r.pid,parent:process.pid}));
      ${mode === 'after-publish' ? 'original(from,to);' : ''}
      ${mode === 'bind-failure' ? "throw new Error('controlled process registration failure');" : "process.kill(process.pid,'SIGKILL');"}
    }
  }
  return original(from,to);
};
`)
          }
          const args = ['PATH=' + path.join(p.root, 'bin') + path.delimiter + process.env.PATH,
            'DEVELOPER_DIR=/controlled/sdk', process.execPath, '--import', platform, ...(preload ? ['--import', preload] : []),
            'scripts/ios-app.mjs', 'debug', 'create']
          const workerFile = p.write('worker.mjs', `
import fs from 'node:fs';
import {runCommand} from ${JSON.stringify(new URL('../lib/ios-ci-run.mjs', import.meta.url).href)};
import {errorMessage} from ${JSON.stringify(new URL('../lib/ios-errors.mjs', import.meta.url).href)};
${mode === 'seal-failure' ? `const original=fs.writeFileSync;
fs.writeFileSync=(file,...args)=>{
  if(String(file).includes('/ios-process-') && String(file).includes('/.closed-') && fs.existsSync(${JSON.stringify(late)})){
    original(${JSON.stringify(sealFailure)},JSON.stringify({code:'ENOSPC'}));
    throw Object.assign(new Error('controlled seal write failure'),{code:'ENOSPC'});
  }
  return original(file,...args);
};` : ''}
const started=Date.now();
try{await runCommand(${JSON.stringify(p.root)},'/usr/bin/env',${JSON.stringify(args)},${JSON.stringify(path.join(p.root, 'outer.log'))},${executionBudget},{cleanupGraceMs:500});process.exitCode=2}
catch(error){fs.writeFileSync(${JSON.stringify(workerResult)},JSON.stringify({error:errorMessage(error),elapsed:Date.now()-started}));process.exitCode=1}
`)
          const worker = spawn(process.execPath, [workerFile], { cwd: p.root, detached: true, stdio: 'ignore' })
          const ended = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('close', resolve) })
          const started = Date.now()
          try {
            await waitForProcessState(() => fs.existsSync(initial))
            // 取消从创建进程实际就绪后开始；真实超时场景仍由执行器自己的执行预算触发。
            const cancelRequestedAt = Date.now()
            if (mode !== 'timeout') worker.kill('SIGTERM')
            assert.equal(await ended, 1)
            const result = JSON.parse(fs.readFileSync(workerResult))
            if (mode === 'timeout') {
              assert.ok(result.elapsed >= executionBudget, '执行超时不能误用缩短后的清理宽限')
              assert.ok(Date.now() - started < executionBudget + 3500, '超时后不等待内层新的 10 秒补偿预算')
            } else {
              assert.ok(Date.now() - cancelRequestedAt < 3500, '取消后不等待内层新的 10 秒补偿预算')
            }
            if (mode === 'slow-preflight')
              assert.ok(cancelRequestedAt - started >= 650, '实际慢预检超过清理宽限仍能到达创建阶段')
            if (mode === 'seal-failure') {
              assert.ok(fs.existsSync(sealFailure), '实际触发关闭标记写入失败')
              assert.match(result.error, /controlled seal write failure/, '清理已登记组后仍保留关闭失败')
            }
            if (preload) {
              assert.ok(fs.existsSync(gate), '实际中断了补偿组登记')
              assert.equal(fs.existsSync(late), false, '尚未完成放行，实际工具不能执行')
              await waitForProcessState(() => !isRunningProcess(JSON.parse(fs.readFileSync(gate)).pid))
            } else {
              assert.ok(fs.existsSync(late), '实际工具在取消后的补偿中启动')
              await waitForProcessState(() => !isRunningProcess(Number(fs.readFileSync(late))))
            }
            assert.ok(isRunningProcess(sentinel.pid))
          } finally {
            worker.kill('SIGKILL')
            if (fs.existsSync(late)) {
              const pid = Number(fs.readFileSync(late))
              const group = Number(spawnSync('ps', ['-p', String(pid), '-o', 'pgid='], { encoding: 'utf8' }).stdout.trim())
              killOwnedGroup(group)
            }
            for (const file of [gate, initial]) if (fs.existsSync(file)) {
              const record = JSON.parse(fs.readFileSync(file))
              killOwnedGroup(record.pid)
              killOwnedGroup(record.parent)
            }
            killOwnedGroup(worker.pid)
            await ended
          }
        })
      }
    } finally {
      killOwnedGroup(sentinel.pid)
      await sentinelEnded
    }
  })

test('CI 关闭标记失败仍读取登记组并先清理内层，保留失败且旧回调不能再次清理', () => {
  const originalKill = process.kill, originalTimer = globalThis.setTimeout
  const signals = [], callbacks = [], outer = 200101, late = 200102
  const failure = Object.assign(new Error('controlled seal failure'), { code: 'ENOSPC' })
  let retained, readCount = 0
  try {
    process.kill = (pid, signal) => {
      signals.push([pid, signal])
      return true
    }
    globalThis.setTimeout = (fn, ms) => {
      assert.equal(ms, 0, '零宽限不因关闭失败增加等待')
      callbacks.push(fn)
      return undefined
    }
    const cleanup = processCleanup(outer, { graceMs: 0, scope: {
      seal() { throw failure },
      groups() {
        readCount++
        return new Set([outer, late])
      },
      finish(error) { retained = error }
    } })
    cleanup.stop('SIGKILL')
    assert.throws(() => cleanup.finish(), (error) => error === failure)
    assert.equal(retained, failure, '清理成功也不能抹除关闭标记失败')
    assert.equal(readCount, 2, '首次强杀及最终收尾均尝试读取登记组')
    assert.deepEqual(signals.filter(([, signal]) => signal === 'SIGKILL').map(([pid]) => pid),
      [-late, -outer, -late, -outer])
    const completed = signals.length
    cleanup.stop()
    cleanup.finish()
    callbacks[0]()
    assert.equal(signals.length, completed, '迟到回调不复活已完成的清理')
  } finally {
    process.kill = originalKill
    globalThis.setTimeout = originalTimer
  }
})

test('CI 共享清理器不延长重复停止的宽限，完成后旧回调失效，进程树读取失败不伪报成功', (t) => {
  const p = fixture(t), ps = p.write('bin/ps', '#!/bin/sh\nexit 1\n')
  fs.chmodSync(ps, 0o755)
  const originalKill = process.kill, originalTimer = globalThis.setTimeout, originalPath = process.env.PATH
  try {
    for (const failSnapshot of [false, true]) {
      const signals = [], callbacks = []
      process.env.PATH = failSnapshot ? path.join(p.root, 'bin') + path.delimiter + originalPath : originalPath
      process.kill = (pid, signal) => { signals.push([pid, signal]); return true }
      globalThis.setTimeout = (fn) => { callbacks.push(fn); return undefined }
      const cleanup = processCleanup(Number.MAX_SAFE_INTEGER)
      cleanup.stop()
      cleanup.stop('SIGINT')
      assert.equal(callbacks.length, 1, '重复停止不重新计算宽限')
      if (failSnapshot) assert.throws(() => cleanup.finish(), /无法读取受管进程树/)
      else cleanup.finish()
      const completed = signals.length
      cleanup.finish()
      callbacks[0]()
      cleanup.stop()
      assert.equal(signals.length, completed, '迟到回调和重复收尾不能重新发信号')
    }
  } finally {
    process.kill = originalKill
    globalThis.setTimeout = originalTimer
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
  }
})

test('CI 清理直接发送实际信号，拒绝真实 EPERM，保留执行主因和清理原因', () => {
  const original=process.kill, calls=[]
  try {
    process.kill=(pid,signal)=>{
      calls.push([pid,signal])
      if (signal===0) throw Object.assign(new Error('probe permission denied'),{code:'EPERM'})
      return true
    }
    const cleanup=processCleanup(200201,{graceMs:0,scope:{seal(){},groups(){return new Set([200201])},finish(){}}})
    cleanup.finish()
    assert.deepEqual(calls,[[-200201,'SIGKILL']], '权限探测不能误拦实际清理')
    process.kill=()=>{throw Object.assign(new Error('real permission denied'),{code:'EPERM'})}
    const denied=processCleanup(200202,{graceMs:0,scope:{seal(){},groups(){return new Set([200202])},finish(){}}})
    const primary=new Error('BOOT_EXECUTION_TIMEOUT')
    assert.throws(()=>finishCleanup(denied,primary),error=>{
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors[0],primary)
      assert.match(error.errors[1].message,/200202.*SIGKILL.*EPERM/)
      return true
    })
  } finally {process.kill=original}
})

test('CI 设备服务成功交接仅释放本组，取消时仍强杀且不误清理其他任务', () => {
  const original=process.kill,calls=[]
  try {
    process.kill=(pid,signal)=>{calls.push([pid,signal]);return true}
    const scope={seal(){},groups(){return new Set([200301,200302])},finish(){}}
    processCleanup(200301,{graceMs:0,scope}).finish({handoff:true})
    assert.deepEqual(calls,[[-200302,'SIGKILL']])
    calls.length=0
    const cancelled=processCleanup(200301,{graceMs:0,scope})
    cancelled.stop('SIGKILL');cancelled.finish({handoff:true})
    assert.ok(calls.some(([pid,signal])=>pid===-200301&&signal==='SIGKILL'),'取消不能以交接跳过清理')
    assert.ok(calls.every(([pid])=>[-200301,-200302].includes(pid)))
  } finally {process.kill=original}
})

test('CI 慢快照计入既有宽限，内外层失败不被快照故障覆盖', {timeout:10000}, async t => {
  const p=processFixture(t), original=process.env.PATH
  const ps=p.write('bin/ps', `#!${process.execPath}
const {spawnSync}=require('node:child_process');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,650);
const r=spawnSync('/bin/ps',process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);
`)
  fs.chmodSync(ps,0o755)
  process.env.PATH=path.join(p.root,'bin')+path.delimiter+original
  try {
    const started=Date.now()
    await assert.rejects(runCommand(p.root,process.execPath,['-e','setInterval(()=>{},1000)'],path.join(p.root,'slow.log'),100),/命令失败或取消/)
    assert.ok(Date.now()-started<3000,'慢快照不增加第二轮清理宽限')
    // 清理前置失败仍不能把命令主错误（exit=7）抹掉；分别覆盖外层和实际内层 CLI。
    p.write('bin/ps','#!/bin/sh\nexit 1\n');fs.chmodSync(ps,0o755)
    await assert.rejects(runCommand(p.root,process.execPath,['-e','process.exit(7)'],path.join(p.root,'failed.log'),1000),error=>{
      assert.ok(error instanceof AggregateError)
      assert.match(error.errors[0].message,/exit=7/)
      assert.match(error.errors[1].message,/无法读取受管进程树/)
      return true
    })
    p.write('scripts/lib/ios-app-full.sh','exit 7\n')
    const run=spawnSync(process.execPath,['scripts/ios-app.mjs','common'],{cwd:p.root,env:process.env,encoding:'utf8',timeout:3000})
    assert.equal(run.status,1,run.stderr)
    assert.match(run.stderr,/exit=7/);assert.match(run.stderr,/无法读取受管进程树/)
  } finally {process.env.PATH=original}
})

test('CI 放行帧不等待父流 EOF，半帧和非法帧拒绝，启动轨迹不污染命令输出', {timeout:12000}, async t => {
  for(const shellGate of fs.existsSync('/bin/zsh')?[false,true]:[false])
  for(const frame of ['GO\n','fragmented','G','','GO\nextra']) {
    const child=spawn(shellGate?'/bin/zsh':process.execPath,[...(shellGate?['-f']:[]),path.join(repository,'scripts/lib/ios-process-launch.'+(shellGate?'sh':'mjs')),process.execPath,'-e',"console.log('CONTROLLED_GATE_TOOL '+process.pid)"],
      {detached:true,stdio:['ignore','pipe','pipe','pipe','pipe']})
    let stdout='',stderr='',trace=''
    child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdio[4].on('data',b=>trace+=b)
    child.stdio[4].end()
    child.stdio[3].allowHalfOpen=true
    const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code))})
    try {
      const valid=frame==='GO\n'||frame==='fragmented'
      if(valid) {
        if(frame==='fragmented') {
          child.stdio[3].write('G');await waitForProcessState(()=>trace.includes('\"bytes\":1'))
          child.stdio[3].write('O');await waitForProcessState(()=>trace.includes('\"bytes\":2'))
          child.stdio[3].write('\n')
        } else child.stdio[3].write(frame)
        await waitForProcessState(()=>stdout.includes('CONTROLLED_GATE_TOOL'))
        assert.equal(child.stdio[3].writableEnded,false,'实际父流尚未 EOF，工具已经启动')
        child.stdio[3].end()
      } else child.stdio[3].end(frame)
      const code=await ended
      assert.equal(code,valid?0:1,stderr)
      if(valid) {assert.match(stdout,/^CONTROLLED_GATE_TOOL \d+\n$/);if(shellGate)assert.equal(stdout,'CONTROLLED_GATE_TOOL '+child.pid+'\n','macOS 放行后 exec 原位替换，不额外创建 Node 或改变进程组长')} else assert.equal(stdout,'')
      const events=trace.trim().split('\n').map(JSON.parse)
      assert.equal(events[0].stage,'waiting');assert.ok(events.every(v=>v.pid===child.pid&&v.uid===process.getuid()))
      assert.equal(events.some(v=>v.stage==='started'),valid)
    } finally {
      child.stdio[3].destroy();killOwnedGroup(child.pid);await ended
    }
  }
})

test('CI 迟到启动轨迹不能复活已关闭登记', t => {
  const p=fixture(t),scope=commandScope(p.root,{})
  const directory=JSON.parse(scope.env.MYBILL_PROCESS_SCOPE).directory
  scope.bind(200701);scope.noteLauncher({stage:'waiting',pid:200701})
  scope.finish()
  assert.equal(fs.existsSync(directory),false)
  scope.noteLauncher({stage:'exited',pid:200701})
  assert.equal(fs.existsSync(directory),false)
})

test('CI 诊断撤销信号通过真实命令入口清理子进程，预先撤销不启动命令', async t => {
  const p=fixture(t),controller=new AbortController(),ready=path.join(p.root,'ready.pid')
  const pending=runCommand(p.root,process.execPath,['-e',`require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`],
    path.join(p.root,'abort.log'),10000,{cleanupGraceMs:100,signal:controller.signal})
  const rejected=assert.rejects(pending,/取消/)
  await waitForProcessState(()=>fs.existsSync(ready))
  const pid=Number(fs.readFileSync(ready));controller.abort();await rejected
  await waitForProcessState(()=>!isRunningProcess(pid))
  const log=path.join(p.root,'not-started.log')
  await assert.rejects(runCommand(p.root,process.execPath,['-e','process.exit(0)'],log,1000,{signal:controller.signal}),/启动前已取消/)
  assert.equal(fs.existsSync(log),false)
})

test('CI 活动进程登记按父子范围隔离，关闭后拒绝续建，错误令牌和链接不能越界', (t) => {
  const p = fixture(t), root = commandScope(p.root, {}), other = commandScope(p.root, {})
  const left = commandScope(p.root, root.env), right = commandScope(p.root, root.env)
  try {
    root.bind(200001); other.bind(200002); left.bind(200003); right.bind(200004)
    assert.deepEqual([...left.groups()], [200003])
    assert.deepEqual([...other.groups()], [200002])
    assert.deepEqual([...root.groups()].sort(), [200001, 200003, 200004])
    left.seal()
    assert.throws(() => commandScope(p.root, left.env), /已关闭/)
    const continuing = commandScope(p.root, right.env)
    continuing.bind(200005)
    assert.ok(root.groups().has(200005))
    continuing.finish()
    const uncertain = commandScope(p.root, right.env)
    uncertain.bind(200006)
    uncertain.finish(new Error('controlled cleanup failure'))
    uncertain.finish()
    assert.throws(() => uncertain.bind(200007), /已绑定或关闭/)
    assert.ok(root.groups().has(200006), '清理失败的组仍由外层持有，不提前摘除')
    assert.throws(() => commandScope(p.root, uncertain.env), /已关闭/)
    const wrong = JSON.parse(root.env.MYBILL_PROCESS_SCOPE)
    wrong.nonce = JSON.parse(other.env.MYBILL_PROCESS_SCOPE).nonce
    assert.throws(() => commandScope(p.root, { MYBILL_PROCESS_SCOPE: JSON.stringify(wrong) }), /不匹配/)
    const context = JSON.parse(other.env.MYBILL_PROCESS_SCOPE), target = p.write('unrelated.txt', 'PRESERVE')
    fs.symlinkSync(target, path.join(context.directory, '.closed-' + context.member))
    assert.throws(() => other.seal())
    assert.equal(fs.readFileSync(target, 'utf8'), 'PRESERVE')
  } finally {
    left.finish(); right.finish(); root.finish(); other.finish()
  }
  assert.throws(() => commandScope(p.root, root.env), /ENOENT/)
  const unsafe = fixture(t), outside = path.join(p.root, 'outside')
  fs.mkdirSync(outside)
  fs.mkdirSync(path.join(unsafe.root, '.local'))
  fs.symlinkSync(outside, path.join(unsafe.root, '.local/ios'))
  assert.throws(() => commandScope(unsafe.root, {}), /父目录不能经链接/)
  assert.deepEqual(fs.readdirSync(outside), [])
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
  // 本用例模拟本地入口，不能继承实际托管宿主的 Actions 汇总上下文。
  const env = { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', GITHUB_ACTIONS: 'false' }
  delete env.IOS_CI_PLAN_STATUS
  delete env.IOS_CI_CHECKS_STATUS
  const cli = (...args) =>
    spawnSync(process.execPath, ['scripts/ios-ci.mjs', ...args], {
      cwd: p.root,
      encoding: 'utf8',
      env
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
  const source = p.write('app/src/sample.ts','export const value=1')
  const rawCoverage = { [source]:{path:source,s:{0:1},statementMap:{0:{start:{line:1,column:0},end:{line:1,column:20}}},f:{},fnMap:{},b:{},branchMap:{}} }
  const metrics = {lines:{total:1,covered:1,pct:100},statements:{total:1,covered:1,pct:100},functions:{total:0,covered:0,pct:100},branches:{total:0,covered:0,pct:100}}
  const summary = {total:metrics,[source]:metrics}
  const coverageProof = p.write(path.relative(p.root,path.join(proof,'coverage-proof.json')),coverageReport(p.root,rawCoverage,summary))
  p.write(path.relative(p.root,path.join(proof,'coverage-final.json')),rawCoverage)
  p.write(path.relative(p.root,path.join(proof,'coverage-summary.json')),summary)
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
    '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
  )
  const phases = requiredModePhases('common').map(([stage, coverage], i) => {
    const log = coverage === 'check/script-tests' ? scriptLog :
      p.write(path.relative(p.root, path.join(proof, `phase-${i}.log`)), 'phase completed\n')
    return { stage, coverage: [coverage], log, status: 'passed',
      ...(coverage === 'check/app-tests' ? { report: appReport } : coverage === 'check/app-coverage' ? {report:coverageProof} : {}) }
  })
  p.write(path.relative(p.root, path.join(proof, 'result.json')), {
    scope: 'engineering',
    status: 'passed',
    mode: 'common',
    timings: phases
  })
  await executeGroup(p.root, directory, 'linux')
  assert.equal(reconcile(p.root, directory).status, 'passed')
  const receiptFile = path.join(directory, 'app-common/receipt.json'),
    receipt = JSON.parse(fs.readFileSync(receiptFile))
  const report = receipt.reports.find(
    (r) => r.role === 'primary' && r.path.endsWith('-app-tests.json')
  )
  const { digest } = await import('../lib/ios-ci-plan.mjs')
  const primaryReport = receipt.reports.find((r) => r.primary && r.role === 'primary')
  const primaryFile = path.join(directory, 'app-common', primaryReport.path)
  const original = JSON.parse(fs.readFileSync(primaryFile))
  const proofFile = path.join(proof, 'result.json')
  fs.writeFileSync(proofFile, JSON.stringify({ ...original, timings: phases.slice(1) }))
  const incomplete = prepare(p, 'app-common', 'incomplete-phase')
  await assert.rejects(executeGroup(p.root, incomplete.directory, 'linux'), /缺少必需阶段/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(incomplete.directory, 'group-linux.json'))).status, 'failed')
  fs.writeFileSync(proofFile, JSON.stringify(original))
  for (const missing of phases) {
    const bytes = Buffer.from(JSON.stringify({ ...original, timings: phases.filter((p) => p !== missing) }))
    fs.writeFileSync(primaryFile, bytes)
    primaryReport.hash = digest(bytes)
    fs.writeFileSync(receiptFile, JSON.stringify(receipt))
    assert.equal(reconcile(p.root, directory).status, 'incomplete', missing.coverage[0])
  }
  const restored = Buffer.from(JSON.stringify(original))
  fs.writeFileSync(primaryFile, restored)
  primaryReport.hash = digest(restored)
  fs.writeFileSync(receiptFile, JSON.stringify(receipt))
  assert.equal(reconcile(p.root, directory).status, 'passed')
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
  p.write('scripts/lib/ios-test-reports.mjs', fs.readFileSync(path.join(repository, 'scripts/lib/ios-test-reports.mjs'), 'utf8'))
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
  const definition = checkDefinition(p.root, p.root, 'script-tests')
  assert.deepEqual(definition.args, ['scripts/lib/ios-checks.mjs', 'run-script-tests'])
  p.write('scripts/tests/ios-added.test.mjs', "import {test} from 'node:test';test('runs',()=>{});test.todo('required regression');\n")
  const pending = spawnSync(process.execPath, definition.args, { cwd: p.root, encoding: 'utf8' })
  assert.notEqual(pending.status, 0)
  assert.match(pending.stderr, /TODO/)
  p.write('scripts/tests/ios-added.test.mjs', "import {test} from 'node:test';test('runs',()=>{});test.skip('unregistered skip');\n")
  const skipped = spawnSync(process.execPath, definition.args, { cwd: p.root, encoding: 'utf8' })
  assert.notEqual(skipped.status, 0)
  assert.match(skipped.stderr, /跳过/)
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


test('T11 报表专项覆盖新计算和原页面消费者，完整触摸要求多维实际执行与回读', t => {
  const r = registry(fixture(t).root)
  for(const file of ['app/src/data/reports/dimensionReports.ts','app/src/data/reports/reportMath.ts',
    'app/test-support/dimensionReportScenarios.ts','app/src/composables/useReportData.ts','app/src/views/ReportView.vue']) {
    assert.ok(selectSuites(r,'change',[file]).some(s=>s.name==='ui-report-dimensions'),file)
  }
  assert.ok(!selectSuites(r,'change',['app/src/data/reports/dimensionReports.spec.ts']).some(s=>s.kind==='ui'))
  const phases = requiredModePhases('ios-touch')
  assert.ok(phases.some(([, , log])=>log==='touch-dimensions.log'))
  assert.ok(phases.some(([, , log])=>log==='touch-dimensions-readback.log'))
})

test('T12 文件/数据管理分流使用同一专项，完整报告缺失文件触摸或回读均拒绝', t => {
  const r=registry(fixture(t).root)
  for(const file of ['app/src/components/DataManagementActions.vue','app/src/api/exports.ts','app/src/data/management/dataManagement.ts','app/src/platform/ledgerTransfers.ts','app/src/data/entries/querySql.ts','app/src/data/ledgerDatabase.ts','app/src/Views/ProfileView.vue'.replace('Views','views')]) {
    const selected = selectSuites(r,'change',[file]).map(s=>s.name)
    assert.ok(selected.includes('ui-data-management'),file)
    assert.ok(!selected.includes('touch'),file)
  }
  assert.ok(!selectSuites(r,'change',['app/src/data/management/dataManagement.spec.ts']).some(s=>s.name==='ui-data-management'))
  assert.equal(r.suites['ui-data-management'].scenario,'data-cycle')
  const phases=requiredModePhases('ios-touch')
  assert.ok(phases.some(([,,log])=>log==='touch-data.log'))
  assert.ok(phases.some(([,,log])=>log==='touch-data-readback.log'))
})


test('T12 CSV 索引迁移和受管续作分别进入原生与脚本套件，不自动扩大完整触摸', t => {
  const r=registry(fixture(t).root)
  for(const file of ['app/src/data/migrations/0009_csv_export.sql','app/src/data/migrations/0009_schema.json']) {
    const names=selectSuites(r,'change',[file]).map(s=>s.name)
    assert.ok(names.includes('app-common')&&names.includes('native-sqlite'))
    assert.ok(!names.includes('touch'))
  }
  for(const file of ['scripts/fixtures/ios-ui-baseline.py','scripts/fixtures/ios_data_management.py','scripts/fixtures/dictionary-touch.py']) {
    const names=selectSuites(r,'change',[file]).map(s=>s.name)
    assert.ok(names.includes('scripts')&&names.includes('scripts-macos'),file)
    assert.ok(!names.includes('touch'),file)
  }
})


test('CI 预热宿主观察器保留主退出码，仅记录本轮树的实际 PGID 和 UID', {timeout:15000}, async t => {
  for(const managed of [false,true])await t.test(managed?'观察至管理完成':'启动即停止',async t=>{
  const p=fixture(t)
  const code=`
    const fs=require('node:fs'),path=require('node:path');
    (async()=>{
      const {commandScope}=await import(${JSON.stringify(new URL('../lib/ios-process-scope.mjs',import.meta.url).href)});
      const own=commandScope(process.cwd(),{});own.bind(process.pid);
      const foreign=commandScope(process.cwd(),{});foreign.bind(process.ppid);
      const directory=JSON.parse(foreign.env.MYBILL_PROCESS_SCOPE).directory;
      const header=path.join(directory,'scope.json'),value=JSON.parse(fs.readFileSync(header));
      value.owner=process.ppid;fs.writeFileSync(header,JSON.stringify(value));
      const base=path.join(process.cwd(),'.local/ios/tmp/ai-agent');
      const until=Date.now()+8000;
      let published=false, managedAt=0;
      const timer=setInterval(()=>{
        const file=fs.readdirSync(base).find(n=>n.startsWith('ios-host-processes-'));
        const text=file?fs.readFileSync(path.join(base,file),'utf8'):'';
        if(process.platform!=='darwin') {clearInterval(timer);process.exit(7)}
        if(text.includes('"process": {"pid": '+process.pid)&&!published) {
          const boot=path.join(base,'ios-debug-owned');fs.mkdirSync(boot);
          fs.writeFileSync(path.join(boot,'boot-readiness.json'),JSON.stringify({scope:'environment',status:'passed',afterBoot:${managed}?'close':undefined}));published=true;
          if(${managed}){managedAt=Date.now();fs.writeFileSync(path.join(boot,'boot-lifecycle.json'),JSON.stringify({status:'running',commands:[{pid:process.pid,startedAt:Date.now()}]}))}
        }
        if(${managed}&&managedAt>0){
          if(text.includes('"observationComplete": "boot-ready"')){clearInterval(timer);process.exit(9)}
          if(Date.now()-managedAt>750){fs.writeFileSync(path.join(base,'ios-debug-owned/boot-lifecycle.json'),JSON.stringify({status:'passed'}));managedAt=-1}
        }
        if(text.includes('"observationComplete": "boot-ready"')) {clearInterval(timer);process.exit(7)}
        else if(Date.now()>until){clearInterval(timer);process.exit(8)}
      },20);
    })();
  `
  const child=spawn('python3',[path.join(repository,'scripts/lib/ios-host-diagnostics.py'),'--',process.execPath,'-e',code],
    {cwd:p.root,detached:true,stdio:['ignore','pipe','pipe']})
  let stderr='';child.stderr.on('data',b=>stderr+=b);child.stdout.resume()
  const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)})
  assert.equal(status,7,stderr)
  const base=path.join(p.root,'.local/ios/tmp/ai-agent')
  const file=fs.readdirSync(base).find(n=>n.startsWith('ios-host-processes-'))
  const rows=fs.readFileSync(path.join(base,file),'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(rows.at(-1).commandExit,7)
  if(process.platform==='darwin') {
    assert.equal(rows[0].self.pid,child.pid)
    assert.equal(rows[0].self.uid,process.getuid())
    assert.equal(rows[0].self.ppid,process.pid)
    assert.equal(rows[0].self.pgid,child.pid)
    assert.ok(rows.some(r=>r.process?.ppid===child.pid&&r.process.uid===process.getuid()&&r.process.pgid>1))
    assert.ok(rows.every(r=>r.process?.pid!==child.pid),'外部父进程不能被登记冒充为本轮命令树')
    const stopped=rows.findIndex(r=>r.observationComplete==='boot-ready')
    assert.ok(stopped>0)
    assert.ok(rows.slice(stopped+1).every(r=>!r.process&&!r.load),'预检通过后不干扰后续测量')
  } else assert.match(rows[0].unavailable,/requires Darwin/)
  })
})


test('CI 宿主聚合必须显式请求且只在托管 macOS 开放，本机拒绝前不启动命令', t => {
  const p=fixture(t),marker=path.join(p.root,'should-not-run')
  for(const env of [{GITHUB_ACTIONS:'false',RUNNER_OS:'macOS'},{GITHUB_ACTIONS:'true',RUNNER_OS:'Linux'}]) {
    const result=spawnSync('python3',[path.join(repository,'scripts/lib/ios-host-diagnostics.py'),'--host-summary','--',
      process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`],
      {cwd:p.root,env:{...process.env,...env},encoding:'utf8',timeout:3000})
    assert.equal(result.status,1,result.stderr)
    assert.match(result.stderr,/host summary requires/)
    assert.equal(fs.existsSync(marker),false)
  }
})


test('CI 冷启动前解析官方 simctl 原生工具，校验版本、许可准备和来源且不执行安装', async () => {
  const framework='/Library/Developer/PrivateFrameworks/CoreSimulator.framework'
  const target=framework+'/Versions/A/Resources/bin/simctl'
  const entry='/Applications/Xcode.app/Contents/Developer/usr/bin/simctl'
  const wrapper='#!/bin/bash\nEXPECTED_VERSION="1171.7"\nexec "'+target+'" "${@}"\n'
  for(const mode of ['valid','equal','sdk-user-owned','quote-variant','old','bad-version','bad-owner','writable','bad-target','outside','unknown','binary']) {
    const calls=[],closed=[]
    const bytes=file=>file===entry&&mode!=='binary'?Buffer.from(mode==='unknown'?'#!/bin/sh\nexec custom-tool "$@"':mode==='quote-variant'?wrapper.replace('EXPECTED_VERSION="1171.7"',"EXPECTED_VERSION='1171.7'").replace('"${@}"','"$@"'):wrapper):
      Buffer.from(mode==='bad-target'?'not executable':'cffaedfe','hex')
    const files={existsSync:()=>true,statSync:file=>({isFile:()=>true,uid:file===target&&mode==='bad-owner'?process.getuid()+1:file===entry&&mode==='sdk-user-owned'?process.getuid():0,
      mode:file===target&&mode==='writable'?0o100777:file===entry&&mode==='sdk-user-owned'?0o100775:0o100755}),
      realpathSync:()=>mode==='outside'?'/tmp/other':target,
      openSync:file=>file,closeSync:file=>closed.push(file),
      readSync:(file,buffer)=>{const value=bytes(file);value.copy(buffer);return value.length}}
    const command=async(program,args)=>{
      calls.push([program,...args])
      if(program==='xcrun')return {text:entry}
      if(program==='/usr/libexec/PlistBuddy')return {text:mode==='old'?'1171.6':mode==='equal'?'1171.7.0':mode==='bad-version'?'invalid':'1174.21'}
      assert.equal(program,'xcodebuild');assert.deepEqual(args,['-checkFirstLaunchStatus']);return {text:''}
    }
    if(['old','bad-version','bad-owner','writable','bad-target','outside'].includes(mode))
      await assert.rejects(resolveSimctl(command,{files}),/CoreSimulator/)
    else {
      const result=await resolveSimctl(command,{files})
      assert.equal(result.program,mode==='unknown'?'xcrun':mode==='binary'?entry:target)
      assert.deepEqual(result.prefix,mode==='unknown'?['simctl']:[])
      if(['valid','equal','sdk-user-owned','quote-variant'].includes(mode))assert.equal(calls.filter(c=>c[0]==='xcodebuild').length,1)
      if(mode==='unknown')assert.equal(result.reason,'unrecognized-wrapper')
    }
    assert.ok(!calls.some(c=>c.includes('-runFirstLaunch')))
    assert.equal(closed.filter(f=>f===entry).length,1)
    calls.length=0
    if(['old','bad-version','bad-owner','writable','bad-target','outside'].includes(mode))
      await assert.rejects(resolveSimctl(command,{files,firstLaunch:false}),/CoreSimulator/)
    else await resolveSimctl(command,{files,firstLaunch:false})
    assert.ok(!calls.some(c=>c[0]==='xcodebuild'),'关闭/暂停仍校验工具来源和版本，但不重复首次启动检查')
  }
})


test('原生启动终态必须匹配单个本轮 UUID，未完成、错误设备及空日志不能通过', () => {
  const id='11111111-1111-4111-8111-111111111111'
  const header='Monitoring boot status for owned ('+id+').\n'
  const finished='Status=4294967295, isTerminal=YES, Elapsed=00:01.\n\tFinished\n'
  assert.equal(assertBootStatus(header+finished,id),'Booted')
  assert.equal(assertBootStatus(header+'Device already booted, nothing to do.\n',id),'Booted')
  for(const text of ['',finished,header+'Status=0, isTerminal=NO\n',header+finished+header,header+finished+'Status=0, isTerminal=NO\n',
    (header+finished).replace(id,'22222222-2222-4222-8222-222222222222')])assert.throws(()=>assertBootStatus(text,id),/原生启动成功终态/)
  assert.throws(()=>assertBootStatus('x'.repeat(262145),id),/过大/)
})


test('CI 纯环境先关闭再查源码，关闭失败只尝试一次且源码漂移仍被拒绝', async t => {
  const originalPlatform=Object.getOwnPropertyDescriptor(process,'platform'),originalPath=process.env.PATH
  const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim()
  Object.defineProperty(process,'platform',{value:'darwin'})
  try {
    for(const mode of ['passed','close-failed','source-changed']) {
      const p=fixture(t), hot=path.join(p.root,'.local/hot'),violation=path.join(p.root,'.local/git-while-hot')
      const git=p.write('bin/git',`#!${process.execPath}
const fs=require('node:fs');if(fs.existsSync(${JSON.stringify(hot)})){
 fs.writeFileSync(${JSON.stringify(violation)},'unexpected');process.exit(19);
}
const r=require('node:child_process').spawnSync(${JSON.stringify(realGit)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);
`)
      fs.chmodSync(git,0o755)
      const {directory}=prepare(p,'simulator-boot','close-'+mode),{session}=environmentSession(p)
      process.env.PATH=path.join(p.root,'bin')+path.delimiter+originalPath
      let closes=0
      const command=async(_root,_program,args)=>{
        assert.equal(args[2],'create');assert.equal(args.at(-1),'close');fs.writeFileSync(hot,'owned');closes++
        if(mode==='close-failed')throw new Error('CONTROLLED_CLOSE_FAILURE')
        fs.unlinkSync(hot)
        if(mode==='source-changed')p.write('app/src/changed.ts','changed after closing')
        return 'SESSION='+session+'\n'
      }
      if(mode==='passed') {
        await executeGroup(p.root,directory,'macos',{command})
        assert.equal(reconcile(p.root,directory).status,'passed')
      } else await assert.rejects(executeGroup(p.root,directory,'macos',{command}),mode==='close-failed'?/CONTROLLED_CLOSE_FAILURE/:/源码/)
      assert.equal(closes,1);assert.equal(fs.existsSync(violation),false)
      process.env.PATH=originalPath
    }
  } finally {Object.defineProperty(process,'platform',originalPlatform);process.env.PATH=originalPath}
})

test('CI 含原生业务先暂停再复用同一会话，环境专项不提前删除设备', async t => {
  const original=Object.getOwnPropertyDescriptor(process,'platform');Object.defineProperty(process,'platform',{value:'darwin'})
  try {
    const p=fixture(t),config=JSON.parse(fs.readFileSync(path.join(p.root,'config/ios-ci.json')))
    config.profiles.app.unshift('simulator-boot');p.write('config/ios-ci.json',config)
    const {directory}=prepare(p,'app','quiesce'),{session}=environmentSession(p,'suspend'),calls=[]
    await assert.rejects(executeGroup(p.root,directory,'macos',{command:async(_root,_program,args)=>{
      calls.push(args)
      if(args[2]==='create'){assert.equal(args.at(-1),'suspend');return 'SESSION='+session+'\n'}
      if(args[2]==='suspend'||args[2]==='close'){assert.equal(args.at(-1),session);return ''}
      assert.equal(args[1],'ios-build');assert.equal(calls.some(a=>a[2]==='close'),false)
      throw new Error('CONTROLLED_AFTER_ENVIRONMENT')
    }}),/CONTROLLED_AFTER_ENVIRONMENT/)
    assert.deepEqual(calls.map(a=>a[2]??a[1]),['create','ios-build','close'])
  } finally {Object.defineProperty(process,'platform',original)}
})


test('CI 停滞短栈只读取本轮同用户原生命令，采样失败不覆盖主结果且仅清理自建采样器', t => {
  const p=fixture(t)
  const source=`
import importlib.util, os
from pathlib import Path
spec=importlib.util.spec_from_file_location('diagnostics',${JSON.stringify(path.join(repository,'scripts/lib/ios-host-diagnostics.py'))})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Child:
 def __init__(self): self.code=None; self.kills=0
 def poll(self): return self.code
 def kill(self): self.kills+=1; self.code=-9
 def wait(self,timeout): return self.code
rows=[]; calls=[]; clock=[100]; children=[]
def factory(args,**kwargs):
 calls.append(args); c=Child(); children.append(c); return c
s=m.StallSample(Path(${JSON.stringify(p.root)}),rows.append,factory,lambda:clock[0])
info={'pid':2001,'uid':os.getuid(),'comm':'simctl'}
for owned,state,at in [(False,info,0),(True,{**info,'uid':os.getuid()+1},0),(True,{**info,'comm':'other-task'},0),(True,info,99000),(True,info,float('nan')),(True,{**info,'pid':9999},0)]:
 s.poll(2001,state,owned,at,lambda:100)
assert not calls
s.poll(2001,info,True,0,lambda:100)
assert len(calls)==1 and calls[0][:4]==['/usr/bin/sample','2001','1','10']
s.poll(2001,info,True,0,lambda:100); assert len(calls)==1
clock[0]=106;s.reap();assert children[0].kills==1 and s.active is None
s.poll(2001,info,True,0,lambda:100);assert len(calls)==1
s.poll(2002,{**info,'pid':2002},True,0,lambda:100);s.reap(final=True);assert children[-1].kills==1
s=m.StallSample(Path(${JSON.stringify(p.root)}),rows.append,lambda *a,**k:(_ for _ in ()).throw(OSError('controlled sample unavailable')))
s.poll(2003,{**info,'pid':2003},True,0,lambda:100);assert rows[-1]['stallSample']=='unavailable'
print('SCOPED_STALL_SAMPLE_VERIFIED')
`
  const out=spawnSync('python3',['-B','-c',source],{encoding:'utf8',timeout:3000})
  assert.equal(out.status,0,out.stderr);assert.match(out.stdout,/SCOPED_STALL_SAMPLE_VERIFIED/)
})

test('完整入口销毁只调用 delete，借用只暂停，删除失败及原主失败均保留', t => {
  const p=fixture(t)
  const source=fs.readFileSync(path.join(repository,'scripts/lib/ios-app-full.sh'),'utf8')
  const cleanup=source.match(/^cleanup\(\) \{[\s\S]*?^\}/m)?.[0]
  assert.ok(cleanup)
  for(const [name,borrowed,state,deleteExit,prior,expected,operations] of [
    ['owned',0,'Booted',0,0,0,['delete']],
    ['borrowed',1,'Booted',0,0,0,['list','shutdown']],
    ['suspended',1,'Shutdown',0,0,0,['list']],
    ['delete-failed',0,'Booted',7,0,1,['delete']],
    ['primary-failed',0,'Booted',0,7,7,['delete']]
  ]) {
    const log=path.join(p.root,name+'.log'),id='11111111-1111-4111-8111-111111111111'
    const script=`SIMULATOR_ID=${id}\nSIMULATOR_BORROWED=${borrowed}\nCRASH_TEST_PID=''\nRUN_DIRECTORY=${JSON.stringify(p.root)}
xcrun() {
 printf '%s\\n' "$2" >> ${JSON.stringify(log)}
 if [[ "$2" = list ]]; then printf '%s\\n' '${JSON.stringify({devices:{runtime:[{udid:id,state}]}})}'; fi
 if [[ "$2" = delete ]]; then return ${deleteExit}; fi
 return 0
}
${cleanup}
(exit ${prior})
cleanup
`
    const out=spawnSync('/bin/bash',['--noprofile','--norc','-c',script],{encoding:'utf8',timeout:3000})
    assert.equal(out.status,expected,out.stderr)
    assert.deepEqual(fs.readFileSync(log,'utf8').trim().split('\n'),operations,name)
  }
})

test('本地按变更与远端常规分流不丢专项，最终仍包含完整原生与容量且拒绝篡改位置', t => {
  const p=fixture(t),r=registry(p.root)
  for(const file of ['app/src/App.vue','app/src/data/ledgerDatabase.ts','scripts/lib/ios-processes.mjs']) {
    const remote=selectSuites(r,'pull-request',[file])
    assert.ok(remote.every(s=>['secrets','check','engineering','audit'].includes(s.kind)),file)
    const local=selectSuites(r,'change',[file],{execution:'local'})
    assert.ok(local.some(s=>['full','ui','environment'].includes(s.kind)),file)
    assert.ok(local.every(s=>!r.onDemandSuites.includes(s.name)),file)
  }
  for(const name of ['simulator-boot','native-sqlite','touch','recovery','scale-10000','final','install-gate']) {
    assert.throws(()=>createPlan(p.root,name,{execution:'remote'}),/远端仅运行常规/)
    assert.throws(()=>requestedScope('workflow_dispatch',{inputs:{verification:name}}),/远端仅接受/)
    assert.throws(()=>requestedScope('push',{ref:'refs/tags/ios-ci/'+name+'/candidate'}))
  }
  const final=createPlan(p.root,'final')
  assert.equal(final.execution,'local')
  for(const n of ['native-sqlite','touch','scale-10000','scale-100000'])assert.ok(final.suites.some(s=>s.name===n),n)
  const altered=structuredClone(final);altered.execution='remote'
  assert.throws(()=>assertPlan(p.root,altered),/远端仅运行常规|失效/)
  p.write('app/src/views/LedgerView.vue','changed')
  const plan=createPlan(p.root,'pull-request',{base:p.base})
  assert.ok(plan.localRequired.some(s=>s.name==='ui-query-input'))
  const directory=resultsDirectory(p.root,'.local/ios/tmp/ai-agent/ios-ci-remote-report',true)
  fs.writeFileSync(path.join(directory,'ci-plan.json'),JSON.stringify(plan))
  const report=reconcile(p.root,directory,'success','success')
  assert.equal(report.status,'incomplete','未执行的常规检查不能通过')
  assert.equal(report.execution,'remote')
  assert.equal(report.completeCandidate,false)
  assert.ok(report.localRequired.some(s=>s.suite==='ui-query-input' && s.status==='not-verified-here'))
  assert.match(fs.readFileSync(path.join(directory,'ci-result.md'),'utf8'),/本地专项（本运行未验证）/)
  const alteredLocal=structuredClone(plan);alteredLocal.localRequired=[]
  assert.throws(()=>assertPlan(p.root,alteredLocal),/失效/)
  p.write('app/src/views/LedgerView.vue','changed again')
  assert.throws(()=>assertPlan(p.root,plan),/失效/)
})

test('真实远端入口在任何启动前拒绝本地模拟器计划，result 不沿用旧绿色',t=>{
  const p=processFixture(t)
  p.write('scripts/ios-ci.mjs',fs.readFileSync(path.join(repository,'scripts/ios-ci.mjs'),'utf8'))
  p.commit()
  const {directory}=prepare(p,'simulator-boot','remote-native-reject')
  const invoke=mode=>spawnSync(process.execPath,['scripts/ios-ci.mjs',mode,'--results',directory,...(mode==='run'?['--group','macos']:[])],{
    cwd:p.root,env:{...process.env,GITHUB_ACTIONS:'true',IOS_CI_PLAN_STATUS:'success',IOS_CI_CHECKS_STATUS:'success'},encoding:'utf8'})
  const run=invoke('run');assert.equal(run.status,1);assert.match(run.stderr,/远端拒绝本地计划/)
  assert.deepEqual(fs.readdirSync(directory),['ci-plan.json'],'拒绝前不创建执行组、套件或设备')
  p.write(path.relative(p.root,path.join(directory,'ci-result.json')),{status:'passed',completeCandidate:true})
  const result=invoke('result');assert.equal(result.status,1,result.stderr)
  const value=JSON.parse(result.stdout);assert.equal(value.status,'incomplete');assert.equal(value.completeCandidate,false)
})
