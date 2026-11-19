import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { selection, APP_ID, RUNTIME, DEVICE_TYPE } from '../lib/ios-debug.mjs'
import {
  controlInputs,
  createDeadline,
  totalBudgets,
  inputHash,
  verificationHash,
  requireEvidence,
  requireEvidenceSet,
  beginFull,
  finishFull,
  requireActiveFull,
  observeFull,
  startPhase,
  finishPhases,
  recordLocal,
  readState,
  needsPhaseRepair,
  caseKey,
  scenarioKey,
  selectedCoverage,
  failureDetails,
  readVitest
} from '../lib/ios-verification.mjs'
import { checkDefinition } from '../lib/ios-checks.mjs'
const environment = JSON.stringify({
  sdk: '27.0',
  xcode: 'Xcode 27.0\n',
  node: process.version,
  arch: process.arch,
  host: os.release(),
  runtime: 'TEST'
})
const ui = (name) => 'DictionaryUITests/DictionaryTouchTests/' + name
const target = ui('test02RenameProduct')
function project(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ios-verification-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (relative, text) => {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    return file
  }
  for (const relative of controlInputs) {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.cpSync(new URL('../../' + relative, import.meta.url), file, { recursive: true })
  }
  for (const name of [
    'app/src/view.vue',
    'app/src/domain/money.spec.ts',
    'app/native-tests/probe.ts',
    'app/test-support/scenario.ts',
    'app/ios/App/project.pbxproj',
    'app/package.json',
    'app/package-lock.json',
    'app/capacitor.config.ts',
    'app/vite.config.ts',
    'app/tsconfig.json',
    'app/tsconfig.tools.json',
    'scripts/normalize-capacitor-spm.mjs'
  ])
    write(name, 'fixture')
  const scenarios = JSON.parse(
    fs.readFileSync(new URL('../../app/native-tests/scenarios.json', import.meta.url))
  )
  write('app/native-tests/scenarios.json', JSON.stringify(scenarios))
  const base = path.join(root, '.local/ios/tmp/ai-agent')
  fs.mkdirSync(base, { recursive: true })
  const session = fs.mkdtempSync(path.join(base, 'ios-debug-')),
    runId = randomUUID(),
    simulatorId = randomUUID()
  fs.writeFileSync(
    path.join(session, 'test-context.json'),
    JSON.stringify({
      schema: 1,
      kind: 'ios-debug',
      state: 'open',
      runId,
      simulatorId,
      appId: APP_ID,
      name: `我的账单调试-${runId}`
    }),
    { mode: 0o600 }
  )
  function evidence(name = target, overrides = {}) {
    const kind = name.startsWith('interruption-') || scenarios.includes(name) ? 'scenario' : 'case'
    const selected = selection('--' + kind, name, scenarios),
      run = fs.mkdtempSync(path.join(session, 'run-'))
    const coverage = selectedCoverage(selected)
    const result = {
      scope: 'partial',
      status: 'passed',
      requested: { kind, name },
      executedCases: selected.cases,
      coverage,
      runId,
      simulatorId,
      inputHash: inputHash(root),
      environment,
      completedAt: Date.now(),
      ...overrides
    }
    fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result))
    const log = selected.recoveryPhases
      ? selected.recoveryPhases.map((p) => 'LEDGER_PROCESS_INTERRUPTION_RECOVERED ' + p).join('\n')
      : selected.cases
          .map(
            (id) =>
              `Test Case '-[${id.split('/')[0]}.${id.split('/')[1]} ${id.split('/')[2]}]' passed (0.1 seconds).`
          )
          .join('\n') +
        `\nExecuted ${selected.cases.length} test${selected.cases.length === 1 ? '' : 's'}, with 0 failures\n` +
        (selected.scenario ? 'NATIVE_DICTIONARY_SCENARIO_VERIFIED ' + selected.scenario : '')
    fs.writeFileSync(path.join(run, 'test.log'), log)
    return { run, result }
  }
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  const executable = (name, code) => {
    const file = write('bin/' + name, code)
    fs.chmodSync(file, 0o755)
  }
  const devices = JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
        {
          udid: simulatorId,
          name: `我的账单调试-${runId}`,
          isAvailable: true,
          deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-14-Pro-Max',
          state: 'Shutdown'
        }
      ]
    }
  })
  executable(
    'xcrun',
    `#!/bin/sh
if [ "$2" = get_app_container ]; then
  if [ "$5" = app ]; then
    if [ "$4" = "${APP_ID}" ]; then bundle=App.app; else bundle=DictionaryUITests-Runner.app; fi
    find "$PWD/.local/ios/tmp/ai-agent" -type d -name "$bundle" -print
  else printf '%s/CoreSimulator/Devices/${simulatorId}/data/Containers/Data/Application/11111111-1111-1111-1111-111111111111\\n' "$PWD"; fi
elif [ \"$3\" = \"devices\" ]; then printf '%s\\n' '${devices}'; elif [ \"$1\" = \"simctl\" ]; then printf '%s\\n' '{"runtimes":[{"identifier":"com.apple.CoreSimulator.SimRuntime.iOS-27-0","isAvailable":true,"buildversion":"TEST"}]}'; else printf '27.0\\n'; fi
`
  )
  executable('xcodebuild', '#!/bin/sh\nprintf "Xcode 27.0\\n"\n')
  executable(
    'npm',
    `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const output = process.argv.find(arg => arg.startsWith('--outputFile='))
if (output && process.argv.includes('--testNamePattern=absent')) {
  fs.writeFileSync(output.slice('--outputFile='.length), JSON.stringify({ testResults: [], numTotalTests: 0 }))
  process.exit(0)
}
if (output) {
  const failed = fs.existsSync('fail-local')
  const assertion = { fullName: 'money sum', status: failed ? 'failed' : 'passed' }
  const suite = { name: path.resolve('app/src/domain/money.spec.ts'), assertionResults: [assertion] }
  fs.writeFileSync(output.slice('--outputFile='.length), JSON.stringify({ testResults: [suite] }))
  process.exit(failed ? 1 : 0)
}
if (process.argv.includes('vite')) {
  fs.mkdirSync('dist', { recursive: true })
  fs.writeFileSync('dist/index.html', 'controlled assets')
}
if (process.argv.includes('cap')) {
  for (const name of ['ios/App/App/public', 'ios/App/CapApp-SPM']) fs.mkdirSync(name, { recursive: true })
  for (const name of ['ios/App/App/public/index.html', 'ios/App/App/capacitor.config.json', 'ios/App/App/config.xml'])
    fs.writeFileSync(name, 'controlled sync')
}
if (process.argv.includes('probe:bundle')) {
  fs.mkdirSync('app/.native-test', { recursive: true })
  fs.writeFileSync('app/.native-test/sqlite-probe.js', 'controlled probe')
}
process.exit(0)
`
  )
  write('scripts/verify-ios-resources.mjs', "console.log('resources verified')\n")
  write('scripts/normalize-capacitor-spm.mjs', "console.log('controlled normalize')\n")
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    CI: 'true',
    MYBILL_FULL_ATTEMPT: '/forged'
  }
  const run = (args, overrides = {}) =>
    spawnSync(process.execPath, [path.join(root, 'scripts/ios-app.mjs'), ...args], {
      cwd: root,
      env: { ...env, ...overrides },
      encoding: 'utf8',
      timeout: 12000
    })
  return {
    root,
    write,
    base,
    session,
    evidence,
    run,
    hash: () => verificationHash(root, environment),
    context: () => ({ inputHash: inputHash(root), environment })
  }
}
function clock(t) {
  let time = 100000
  t.mock.method(Date, 'now', () => ++time)
}

/** 受控安装器保留实际目录和安装状态；只验证 CLI 编排，不调用宿主 Xcode 或模拟器。 */
function runnerProject(t) {
  const p = project(t)
  const npmFile = path.join(p.root, 'bin/npm')
  fs.writeFileSync(npmFile, fs.readFileSync(npmFile, 'utf8')
    .replace("fs.writeFileSync('dist/index.html', 'controlled assets')",
      "fs.writeFileSync('dist/index.html', fs.readFileSync('src/view.vue'))")
    .replace("fs.writeFileSync(name, 'controlled sync')",
      "fs.writeFileSync(name, name.endsWith('public/index.html') ? fs.readFileSync('dist/index.html') : 'controlled sync')"))
  const context = JSON.parse(fs.readFileSync(path.join(p.session, 'test-context.json')))
  const trace = path.join(p.root, 'installation-trace.json'), state = path.join(p.root, 'installed.json')
  const container = path.join(p.root, 'CoreSimulator/Devices', context.simulatorId,
    'data/Containers/Data/Application', randomUUID())
  fs.mkdirSync(container, { recursive: true })
  const executable = (name, body) => {
    const file = p.write('bin/' + name, '#!' + process.execPath + '\n' + body)
    fs.chmodSync(file, 0o755)
  }
  const devices = { devices: { [RUNTIME]: [{ udid: context.simulatorId, name: context.name,
    isAvailable: true, deviceTypeIdentifier: DEVICE_TYPE, state: 'Booted' }] } }
  executable('xcrun', `
const fs=require('node:fs'),a=process.argv.slice(2),state=${JSON.stringify(state)},trace=${JSON.stringify(trace)}
const installed=fs.existsSync(state)?JSON.parse(fs.readFileSync(state)):{}
function log(x){const list=fs.existsSync(trace)?JSON.parse(fs.readFileSync(trace)):[];list.push(x);fs.writeFileSync(trace,JSON.stringify(list))}
if(a[0]!=='simctl')console.log('27.0')
else if(a[1]==='list')console.log(JSON.stringify(a[2]==='devices'?${JSON.stringify(devices)}:{runtimes:[{identifier:${JSON.stringify(RUNTIME)},isAvailable:true,buildversion:'TEST'}]}))
else if(a[1]==='listapps')console.log(JSON.stringify(installed))
else if(a[1]==='get_app_container')console.log(a[4]==='data'?${JSON.stringify(container)}:installed[a[3]].bundle)
else if(a[1]==='install'){
 const app=a[3].endsWith('/App.app'),id=app?'${APP_ID}':'fixture.runner'
 log(app?'install-App':'install-runner')
 if(app&&fs.existsSync(${JSON.stringify(path.join(p.root, 'fail-app'))}))process.exit(9)
 if(!app&&fs.existsSync(${JSON.stringify(path.join(p.root, 'fail-runner'))}))process.exit(9)
 const snapshot=${JSON.stringify(path.join(p.root, 'installed-bundles'))}+'/'+id+'.app'
 fs.rmSync(snapshot,{recursive:true,force:true});fs.cpSync(a[3],snapshot,{recursive:true})
 installed[id]={bundle:snapshot};fs.writeFileSync(state,JSON.stringify(installed))
}else if(a[1]==='uninstall'){
 log('uninstall-App')
 if(fs.existsSync(${JSON.stringify(path.join(p.root, 'fail-uninstall'))}))process.exit(9)
 delete installed[a[3]];fs.writeFileSync(state,JSON.stringify(installed))
}
`)
  executable('plutil', `if(process.argv.includes('-extract'))console.log('fixture.runner');else{let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(s))}`)
  executable('python3', `console.log('controlled fixture boundary')`)
  executable('xcodebuild', `
const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2)
if(a.includes('-version'))console.log('Xcode 27.0')
else if(a[0]==='build-for-testing'){
 const products=path.join(a[a.indexOf('-derivedDataPath')+1],'Build/Products')
 const config=a[a.indexOf('-configuration')+1],scheme=a[a.indexOf('-scheme')+1]
 for(const name of ['App.app',...(scheme==='DictionaryTouch'?['DictionaryUITests-Runner.app']:[])]){
  fs.mkdirSync(path.join(products,config+'-iphonesimulator',name),{recursive:true})
  fs.writeFileSync(path.join(products,config+'-iphonesimulator',name,'binary'),
   name==='App.app'?config+'|'+fs.readFileSync('app/src/view.vue'):'controlled runner')
 }
 fs.writeFileSync(path.join(products,scheme+'.xctestrun'),'controlled plan')
}else{
 const cases=a.filter(x=>x.startsWith('-only-testing:')).map(x=>x.slice(14))
 for(const id of cases){const [bundle,klass,method]=id.split('/');console.log("Test Case '-["+bundle+'.'+klass+' '+method+"]' passed (0.1 seconds).")}
 console.log('Executed '+cases.length+' test'+(cases.length===1?'':'s')+', with 0 failures')
}
`)
  return { ...p, trace, container, args: ['debug', 'run', '--session', p.session, '--case', ui('test00PrepareReportApp')] }
}
function finishAttempt(p, hash, proof, failed = true, required = [target]) {
  const a = beginFull(p.root, 'ios-touch', proof, hash, process.pid, p.context())
  finishFull(p.root, a, failed ? new Error('controlled failure') : undefined, failed ? required : [])
  return a
}

test('当前局部证据校验：失败/旧输入/错误环境/范围/符号链接拒绝，文档变化不作废', (t) => {
  const p = project(t),
    good = p.evidence(),
    read = (run) => requireEvidence(p.root, run, inputHash(p.root), environment)
  assert.equal(read(good.run).run, good.run)
  assert.throws(() => read(undefined), /--from/)
  for (const overrides of [
    { status: 'failed' },
    { inputHash: 'old' },
    { environment: 'different' },
    { coverage: [] },
    { executedCases: [] },
    { coverage: [...good.result.coverage, 'app-test/other.spec.ts#unrelated'] }
  ])
    assert.throws(() => read(p.evidence(target, overrides).run))
  const link = path.join(p.session, 'run-link')
  fs.symlinkSync(good.run, link)
  assert.throws(() => read(link))
  p.write('README.md', 'docs')
  assert.equal(read(good.run).run, good.run)
  fs.appendFileSync(path.join(p.root, 'scripts/fixtures/dictionary-touch.py'), '# changed')
  assert.throws(() => read(good.run), /版本不符/)
})

test('Vitest 配置变更使旧证据和完整输入失效，新配置局部通过后正常复验', t => {
  clock(t)
  const p = project(t)
  p.write('app/vitest.config.ts', 'export default { test: { include: ["src/**/*.spec.ts"] } }')
  const previous = p.evidence(), before = p.hash()
  finishAttempt(p, before, previous, false)
  p.write('app/vitest.config.ts', 'export default { test: { include: ["src/domain/money.spec.ts"] } }')
  assert.notEqual(p.hash(), before)
  assert.throws(() => requireEvidence(p.root, previous.run, inputHash(p.root), environment), /版本不符/)
  const current = p.evidence()
  assert.doesNotThrow(() => requireEvidence(p.root, current.run, inputHash(p.root), environment))
  const attempt = beginFull(p.root, 'ios-touch', current, p.hash(), process.pid, p.context())
  finishFull(p.root, attempt)
  assert.equal(readState(p.root).history.length, 2, '旧输入历史保留，不清除锁和次数')
})

test('A→B→A 保留 A 的初验/复验次数，已通过 A→B→A 也不重复', (t) => {
  clock(t)
  const p = project(t),
    A = 'a'.repeat(64),
    B = 'b'.repeat(64)
  finishAttempt(p, A, p.evidence())
  finishAttempt(p, A, p.evidence())
  assert.throws(() => finishAttempt(p, A, p.evidence()), /初验及一次复验/)
  finishAttempt(p, B, p.evidence())
  assert.throws(() => finishAttempt(p, A, p.evidence()), /初验及一次复验/)
  const q = project(t)
  finishAttempt(q, A, q.evidence(), false)
  finishAttempt(q, B, q.evidence(), false)
  assert.throws(() => finishAttempt(q, A, q.evidence(), false), /拒绝重复/)
})

test('v1 历史回执迁移保留其他版本次数及最近失败，不清空旧记录', (t) => {
  clock(t)
  const p = project(t),
    A = 'a'.repeat(64),
    B = 'b'.repeat(64)
  const a = finishAttempt(p, A, p.evidence())
  finishAttempt(p, A, p.evidence())
  const b = finishAttempt(p, B, p.evidence())
  p.write(
    '.local/ios/tmp/ai-agent/ios-verification-state.json',
    JSON.stringify({ schema: 1, attempts: { 'ios-touch': readState(p.root).attempts['ios-touch'] } })
  )
  const migrated = readState(p.root)
  assert.equal(migrated.schema, 2)
  assert.ok(migrated.history.some((v) => v.run === a.run))
  assert.ok(migrated.history.some((v) => v.run === b.run))
  assert.throws(() => finishAttempt(p, A, p.evidence()), /初验及一次复验/)
})

test('已有成功后，新局部真实失败及相关修复可复验；无故刷绿色、旧/无关证据拒绝', (t) => {
  clock(t)
  const p = project(t),
    H = p.hash()
  finishAttempt(p, H, p.evidence(), false)
  assert.throws(() => finishAttempt(p, H, p.evidence(), false), /拒绝重复/)
  const failure = p.evidence(target, { status: 'failed', failure: { required: [caseKey(target)] } })
  recordLocal(p.root, failure.run, failure.result)
  assert.throws(() => finishAttempt(p, H, p.evidence(ui('test07RestoreCandidates')), false), /相关局部/)
  const repair = p.evidence()
  const repeated = finishAttempt(p, H, repair, false)
  assert.ok(repeated.incident.startsWith('local:'))
  assert.throws(() => finishAttempt(p, H, p.evidence(), false), /拒绝重复/)
  const secondFailure = p.evidence(target, { status: 'failed', failure: { required: [caseKey(target)] } })
  recordLocal(p.root, secondFailure.run, secondFailure.result)
  finishAttempt(p, H, p.evidence(), true)
  assert.throws(
    () =>
      beginFull(
        p.root,
        'ios-smoke',
        p.evidence('NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection'),
        H,
        process.pid,
        p.context()
      ),
    /先处理/
  )
})

test('失败锁保留目标，换套件/旧回执拒绝；特殊恢复可用同阶段成对场景解锁', (t) => {
  clock(t)
  const p = project(t),
    H = p.hash(),
    proof = p.evidence()
  finishAttempt(p, H, proof)
  assert.throws(() => finishAttempt(p, H, proof), /相关局部/)
  assert.throws(() => beginFull(p.root, 'ios-smoke', p.evidence(), H, process.pid, p.context()), /先处理/)
  const q = project(t),
    native = 'NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection'
  const a = beginFull(q.root, 'ios-smoke', q.evidence(native), H, process.pid, q.context())
  startPhase(a.run, {
    stage: 'test',
    coverage: ['recovery/migration-recorded'],
    log: path.join(q.base, 'recovery.log')
  })
  finishFull(q.root, a, new Error('recover failed'), [
    'NativeTests/NativeSqliteTests/testRecoverProcessInterruption'
  ])
  assert.throws(
    () =>
      beginFull(q.root, 'ios-smoke', q.evidence('interruption-snapshot-ready'), H, process.pid, q.context()),
    /相关局部/
  )
  const related = q.evidence('interruption-migration-recorded')
  requireEvidence(q.root, related.run, inputHash(q.root), environment)
  assert.equal(beginFull(q.root, 'ios-smoke', related, H, process.pid, q.context()).retry, 1)
  assert.throws(() => selection('--case', 'NativeTests/NativeSqliteTests/testRecoverProcessInterruption', []))
})

test('构建/安装/启动/单用例分别计时，长构建不误耗启动预算；预期中断失败不误停', (t) => {
  const p = project(t),
    run = fs.mkdtempSync(path.join(p.base, 'ios-full-')),
    log = p.write('.local/ios/tmp/ai-agent/native-clock/test.log', '')
  let time = 1000
  t.mock.method(Date, 'now', () => time)
  const w = observeFull({ run, root: p.root, evidenceRoot: p.base }, { now: () => time })
  startPhase(run, { stage: 'build', coverage: ['native-build/App/Debug'], log })
  time += 200000
  w.poll()
  startPhase(run, { stage: 'install', coverage: ['native-install/App/Debug'], log })
  time += 100000
  w.poll()
  startPhase(run, { stage: 'test', coverage: ['native-startup/App/Debug'], log })
  time += 100000
  w.poll()
  fs.writeFileSync(
    log,
    `Test Case '-[DictionaryUITests.DictionaryTouchTests test02RenameProduct]' started.\n`
  )
  w.poll()
  time += 61000
  assert.throws(() => w.poll(), /60 秒/)
  assert.deepEqual(w.failedCases, [target])
  const times = finishPhases(run, new Error('timeout'))
  assert.equal(times[0].elapsedMs, 200000)
  assert.equal(times[1].elapsedMs, 100000)
  const guard = fs.mkdtempSync(path.join(p.base, 'ios-full-'))
  startPhase(guard, { stage: 'test', coverage: ['recovery/snapshot-ready'], log, expectedFailure: true })
  fs.writeFileSync(
    log,
    "Test Case '-[NativeTests.NativeSqliteTests testPrepareProcessInterruption]' failed (1 seconds).\n"
  )
  observeFull({ run: guard, evidenceRoot: p.base }, { now: () => time }).poll()
  time += 121000
  assert.throws(
    () => observeFull({ run: guard, evidenceRoot: p.base }, { now: () => time }).poll(),
    /中断准备阶段超时/
  )
})

test('各阶段超时与没有进入测试的启动超时明确分类，阶段内日志分块仍识别首败', (t) => {
  const p = project(t)
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  for (const [stage, elapsed] of [
    ['build', 600001],
    ['install', 120001],
    ['test', 180001]
  ]) {
    const run = fs.mkdtempSync(path.join(p.base, 'ios-full-')),
      log = p.write('.local/ios/tmp/ai-agent/native-' + stage + '/test.log', '')
    startPhase(run, { stage, coverage: ['native-startup/App/Debug'], log })
    now += elapsed
    assert.throws(
      () => observeFull({ run, evidenceRoot: p.base }, { now: () => now }).poll(),
      stage === 'test' ? /测试启动阶段/ : new RegExp(stage + ' 阶段超时')
    )
  }
  const run = fs.mkdtempSync(path.join(p.base, 'ios-full-')),
    log = p.write(
      '.local/ios/tmp/ai-agent/native-split/test.log',
      "Test Case '-[DictionaryUITests.DictionaryTouchTests test02RenameProduct]' fa"
    )
  startPhase(run, { stage: 'test', coverage: [caseKey(target)], log })
  const w = observeFull({ run, evidenceRoot: p.base })
  w.poll()
  fs.appendFileSync(log, 'iled (1 seconds).\n')
  assert.throws(() => w.poll(), /立即停止/)
})

test('Vitest、资源及编译失败保留所属层次，不降级成原生入口绿色；检查命令拒绝任意路径', (t) => {
  const p = project(t),
    run = fs.mkdtempSync(path.join(p.base, 'ios-check-')),
    report = p.write(
      '.local/ios/tmp/ai-agent/report.json',
      JSON.stringify({
        testResults: [
          {
            name: path.join(p.root, 'app/src/domain/money.spec.ts'),
            assertionResults: [{ fullName: 'money sum', status: 'failed' }]
          }
        ]
      })
    )
  startPhase(run, { stage: 'check', coverage: ['check/app-tests'], report })
  assert.deepEqual(failureDetails({ run, root: p.root }).required, [
    'app-test/src/domain/money.spec.ts#money sum'
  ])
  assert.throws(() => checkDefinition(p.root, run, 'app-tests', { file: '../private.spec.ts' }))
  assert.throws(() => checkDefinition(p.root, run, 'resources', { scheme: 'App' }))
  assert.throws(() => checkDefinition(p.root, run, 'native-build', { scheme: 'Unknown' }))
  assert.throws(() => checkDefinition(p.root, run, 'resources', { target: 'arbitrary' }))
  startPhase(run, { stage: 'build', coverage: ['native-build/DictionaryTouch/Release'] })
  assert.deepEqual(failureDetails({ run, root: p.root }).required, ['native-build/DictionaryTouch/Release'])
})

test('真实 CLI 首败取消、执行清理并拒绝无关证据；最低层局部修复可解锁', { timeout: 20000 }, (t) => {
  const p = project(t)
  p.write(
    'scripts/lib/ios-app-full.sh',
    `#!/bin/bash
set -e
trap 'echo cleaned > cleanup-receipt; exit 143' TERM INT
mkdir -p .local/ios/tmp/ai-agent/native-controlled
LOG="$PWD/.local/ios/tmp/ai-agent/native-controlled/test.log"
node scripts/lib/ios-verification.mjs phase ios-touch "$MYBILL_FULL_ATTEMPT" test case/${target} "$LOG"
printf "Test Case '-[DictionaryUITests.DictionaryTouchTests test02RenameProduct]' failed (0.1 seconds).\\n" > "$LOG"
sleep 5
echo SHOULD_NOT_CONTINUE > continued
`
  )
  const proof = p.evidence(),
    failed = p.run(['ios-touch', '--from', proof.run])
  assert.equal(failed.status, 1, failed.stderr)
  assert.match(failed.stderr, /立即停止/)
  assert.ok(fs.existsSync(path.join(p.root, 'cleanup-receipt')))
  assert.equal(fs.existsSync(path.join(p.root, 'continued')), false)
  assert.equal(fs.existsSync(path.join(p.base, 'ios-command.lock')), false)
  assert.equal(p.run(['ios-touch', '--from', proof.run]).status, 1)
  const other = p.run(['ios-touch', '--from', p.evidence(ui('test07RestoreCandidates')).run])
  assert.match(other.stderr, /相关局部/)
})

test(
  '真实 CLI 无需 Xcode 的精确 Vitest 局部修复解锁同层失败，新故障可复验但不无限重跑',
  { timeout: 20000 },
  (t) => {
    const p = project(t)
    p.write(
      'scripts/lib/ios-app-full.sh',
      `#!/bin/bash
set -e
if [[ -f allow-pass ]]; then exit 0; fi
mkdir -p .local/ios/tmp/ai-agent/native-unit
LOG="$PWD/.local/ios/tmp/ai-agent/native-unit/test.log"
REPORT="$PWD/.local/ios/tmp/ai-agent/native-unit/vitest.json"
node scripts/lib/ios-verification.mjs phase ios-touch "$MYBILL_FULL_ATTEMPT" check check/app-tests "$LOG" "$REPORT"
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({testResults:[{name:process.cwd()+"/app/src/domain/money.spec.ts",assertionResults:[{fullName:"money sum",status:"failed"}]}]}))' "$REPORT"
exit 1
`
    )
    const first = p.run(['debug', 'check', '--check', 'resources'])
    assert.equal(first.status, 0, first.stderr)
    const from = (text) => text.match(/^EVIDENCE=(.+)$/m)[1]
    const proof = from(first.stdout)
    const full = p.run(['ios-touch', '--from', proof])
    assert.equal(full.status, 1)
    const unrelated = p.run(['ios-touch', '--from', p.evidence(ui('test00EightOriginalEntries')).run])
    assert.match(unrelated.stderr, /app-test.*money sum/)
    p.write('allow-pass', 'fixed environment')
    const local = p.run([
      'debug',
      'check',
      '--check',
      'app-tests',
      '--file',
      'src/domain/money.spec.ts',
      '--name',
      'money sum'
    ])
    assert.equal(local.status, 0, local.stderr)
    const moneyProof = from(local.stdout)
    assert.equal(p.run(['ios-touch', '--from', moneyProof]).status, 0)
    assert.match(p.run(['ios-touch', '--from', moneyProof]).stderr, /拒绝重复/)
    const zero = p.run(['debug', 'check', '--check', 'app-tests', '--name', 'absent'])
    assert.equal(zero.status, 1)
    const justGreen = p.run(['debug', 'check', '--check', 'app-tests'])
    assert.equal(justGreen.status, 0, justGreen.stderr)
    assert.match(p.run(['ios-touch', '--from', from(justGreen.stdout)]).stderr, /拒绝重复/)
    p.write('fail-local', 'newly observed failure')
    assert.equal(
      p.run(['debug', 'check', '--check', 'app-tests', '--file', 'src/domain/money.spec.ts']).status,
      1
    )
    fs.unlinkSync(path.join(p.root, 'fail-local'))
    const repaired = p.run(['debug', 'check', '--check', 'app-tests', '--file', 'src/domain/money.spec.ts'])
    assert.equal(repaired.status, 0, repaired.stderr)
    assert.equal(p.run(['ios-touch', '--from', from(repaired.stdout)]).status, 0)
    assert.match(p.run(['ios-touch', '--from', from(repaired.stdout)]).stderr, /拒绝重复/)
  }
)

test('内部许可绑定工作区锁、存活进程与模式，直接内部调用拒绝', (t) => {
  const p = project(t),
    a = beginFull(p.root, 'ios-touch', p.evidence(), p.hash(), process.pid, p.context())
  assert.throws(() => requireActiveFull(p.root, 'ios-touch', a.run))
  p.write('.local/ios/tmp/ai-agent/ios-command.lock/owner.json', JSON.stringify({ pid: process.pid }))
  assert.equal(requireActiveFull(p.root, 'ios-touch', a.run).run, a.run)
  assert.throws(() => requireActiveFull(p.root, 'ios-smoke', a.run))
  finishFull(p.root, a)
  assert.throws(() => requireActiveFull(p.root, 'ios-touch', a.run))
})

test(
  '真实 CLI 成对恢复局部入口只接受受管阶段，结束后回收活动许可并生成可用证据',
  { timeout: 15000, skip: process.platform !== 'darwin' },
  (t) => {
    const p = project(t)
    p.write(
      'scripts/lib/ios-app-full.sh',
      `#!/bin/bash
set -e
node scripts/lib/ios-verification.mjs permit ios-recovery "$MYBILL_FULL_ATTEMPT"
IFS=',' read -r -a phases <<< "$MYBILL_RECOVERY_PHASES"
for item in "\${phases[@]}"; do echo "LEDGER_PROCESS_INTERRUPTION_RECOVERED $item"; done
`
    )
    const run = p.run([
      'debug',
      'run',
      '--session',
      p.session,
      '--scenario',
      'interruption-migration-recorded'
    ])
    assert.equal(
      run.status,
      0,
      run.stderr +
        run.stdout +
        fs
          .readdirSync(p.session)
          .filter((n) => n.startsWith('run-'))
          .map((n) => fs.readFileSync(path.join(p.session, n, 'test.log'), 'utf8'))
          .join('\n')
    )
    const proof = run.stdout.match(/^EVIDENCE=(.+)$/m)[1]
    assert.ok(!fs.existsSync(path.join(proof, 'active.json')))
    const evidence = requireEvidence(p.root, proof, inputHash(p.root), environment)
    assert.ok(evidence.result.coverage.includes('recovery/migration-recorded'))
    assert.ok(!evidence.result.coverage.includes('recovery/snapshot-ready'))
    const closed = p.run(['debug', 'close', '--session', p.session])
    assert.equal(closed.status, 0, closed.stderr)
    assert.equal(JSON.parse(fs.readFileSync(path.join(p.session, 'test-context.json'))).state, 'closed')
  }
)

test('本机阶段新失败强制重做，相关成功后恢复缓存但仍保留故障复验依据', (t) => {
  clock(t)
  const p = project(t),
    key = 'native-install/App/Debug',
    H = p.hash()
  finishAttempt(p, H, p.evidence(), false)
  const failed = p.evidence(target, { status: 'failed', failure: { required: [key] } })
  recordLocal(p.root, failed.run, failed.result)
  assert.equal(needsPhaseRepair(p.root, key, environment), true)
  assert.equal(needsPhaseRepair(p.root, key, 'another-runtime'), false)
  const unrelated = p.evidence()
  recordLocal(p.root, unrelated.run, unrelated.result)
  assert.equal(needsPhaseRepair(p.root, key), true)
  const repaired = p.evidence(target, { coverage: [caseKey(target), key] })
  recordLocal(p.root, repaired.run, repaired.result)
  assert.equal(needsPhaseRepair(p.root, key), false)
  const attempt = finishAttempt(p, H, repaired, false)
  assert.ok(attempt.incident.startsWith('local:'))
  assert.throws(() => finishAttempt(p, H, p.evidence(), false), /拒绝重复/)
})

test('跨版本/跨套件恢复旧输入仍检查历史失败，修复后可以继续正常验证', (t) => {
  clock(t)
  const p = project(t),
    A = 'A',
    B = 'B'
  finishAttempt(p, A, p.evidence())
  finishAttempt(p, B, p.evidence(), false)
  const native = p.evidence('NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection')
  assert.throws(() => beginFull(p.root, 'ios-smoke', native, A, process.pid, p.context()), /先处理 ios-touch/)
  finishAttempt(p, A, p.evidence(), false)
  const allowed = beginFull(p.root, 'ios-smoke', native, A, process.pid, p.context())
  finishFull(p.root, allowed)
  assert.throws(() => finishAttempt(p, A, p.evidence(), false), /拒绝重复/)
})

test('历史输入的构建失败仍要求重做，其他输入的新成功不覆盖该失败', (t) => {
  clock(t)
  const p = project(t),
    A = p.hash(),
    key = 'native-build/DictionaryTouch/Release'
  const failed = beginFull(p.root, 'ios-touch', p.evidence(), A, process.pid, p.context())
  startPhase(failed.run, { stage: 'build', coverage: [key] })
  finishFull(p.root, failed, new Error('controlled build failure'))
  p.write('app/src/view.vue', 'changed input')
  finishAttempt(p, p.hash(), p.evidence(target, { coverage: [caseKey(target), key] }), false)
  p.write('app/src/view.vue', 'fixture')
  assert.equal(p.hash(), A)
  assert.equal(needsPhaseRepair(p.root, key, environment), true)
})

test('场景名参与失败及成功证据，crud 不能修复 template-tie，也不能伪造场景覆盖', (t) => {
  clock(t)
  const p = project(t),
    H = p.hash(),
    native = 'NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection'
  const baseline = beginFull(p.root, 'ios-smoke', p.evidence(native), H, process.pid, p.context())
  finishFull(p.root, baseline)
  const failed = p.evidence('template-tie', { status: 'failed' })
  startPhase(failed.run, { stage: 'test', scenario: 'template-tie', coverage: failed.result.coverage })
  failed.result.failure = failureDetails({ root: p.root, run: failed.run }, failed.result.executedCases)
  assert.deepEqual(failed.result.failure.required, [scenarioKey('template-tie')])
  recordLocal(p.root, failed.run, failed.result)
  const unrelated = p.evidence('crud')
  requireEvidence(p.root, unrelated.run, inputHash(p.root), environment)
  assert.throws(() => beginFull(p.root, 'ios-smoke', unrelated, H, process.pid, p.context()), /template-tie/)
  const forged = p.evidence('crud', { coverage: [...unrelated.result.coverage, scenarioKey('template-tie')] })
  assert.throws(() => requireEvidence(p.root, forged.run, inputHash(p.root), environment), /未执行范围/)
  fs.writeFileSync(
    path.join(unrelated.run, 'test.log'),
    fs.readFileSync(path.join(unrelated.run, 'test.log'), 'utf8').replace('VERIFIED crud', 'VERIFIED merge')
  )
  assert.throws(() => requireEvidence(p.root, unrelated.run, inputHash(p.root), environment), /场景通过记录/)
  const repaired = p.evidence('template-tie')
  requireEvidence(p.root, repaired.run, inputHash(p.root), environment)
  const allowed = beginFull(p.root, 'ios-smoke', repaired, H, process.pid, p.context())
  finishFull(p.root, allowed)
})

test('多份证据逐份校验，拒绝重复/空集合/过多/旧输入回执', (t) => {
  const p = project(t),
    good = p.evidence(),
    another = p.evidence(ui('test07RestoreCandidates'))
  const read = (paths) => requireEvidenceSet(p.root, paths, inputHash(p.root), environment)
  assert.equal(read([good.run, another.run]).length, 2)
  assert.throws(() => read([]), /1 至 32/)
  assert.throws(() => read(Array(33).fill(good.run)), /1 至 32/)
  assert.throws(() => read([good.run, good.run]), /重复/)
  assert.throws(() => read([good.run, p.evidence(target, { inputHash: 'old' }).run]), /版本不符/)
})

test(
  '真实 CLI 合并跨层修复证据，各目标按自己的失败时间验证，单份/重复/无关证据拒绝',
  { timeout: 20000 },
  async (t) => {
    const p = project(t),
      native = 'NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection'
    p.write('scripts/lib/ios-app-full.sh', '#!/bin/bash\nexit 0\n')
    const from = (text) => text.match(/^EVIDENCE=(.+)$/m)[1]
    assert.equal(p.run(['ios-smoke', '--from', p.evidence(native).run]).status, 0)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const failed = p.evidence(native, { status: 'failed', failure: { required: [caseKey(native)] } })
    recordLocal(p.root, failed.run, failed.result)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const fixedNative = p.evidence(native)
    recordLocal(p.root, fixedNative.run, fixedNative.result)
    p.write('fail-local', 'controlled newer Vitest failure')
    assert.equal(
      p.run(['debug', 'check', '--check', 'app-tests', '--file', 'src/domain/money.spec.ts']).status,
      1
    )
    fs.unlinkSync(path.join(p.root, 'fail-local'))
    const fixedVitest = p.run([
      'debug',
      'check',
      '--check',
      'app-tests',
      '--file',
      'src/domain/money.spec.ts'
    ])
    assert.equal(fixedVitest.status, 0, fixedVitest.stderr)
    const nodeProof = from(fixedVitest.stdout)
    assert.match(p.run(['ios-smoke', '--from', fixedNative.run]).stderr, /app-test/)
    assert.match(p.run(['ios-smoke', '--from', nodeProof]).stderr, /testLedgerLifecycleAndProtection/)
    assert.match(p.run(['ios-smoke', '--from', nodeProof, '--from', nodeProof]).stderr, /重复/)
    const combined = p.run(['ios-smoke', '--from', fixedNative.run, '--from', nodeProof])
    assert.equal(combined.status, 0, combined.stderr)
    const attempt = readState(p.root).attempts['ios-smoke']
    assert.deepEqual(attempt.evidenceRuns, [fixedNative.run, nodeProof])
    assert.match(p.run(['ios-smoke', '--from', fixedNative.run, '--from', nodeProof]).stderr, /拒绝重复/)
  }
)

for (const mode of ['common', 'ios-build']) {
  test(`真实 ${mode} 入口强制阶段许可与构建超时，停止子进程并保存失败耗时`, { timeout: 15000 }, (t) => {
    const p = project(t)
    p.write(
      'scripts/lib/ios-app-full.sh',
      `#!/bin/bash
set -e
trap 'echo cleaned > cleanup-receipt; exit 143' TERM INT
node scripts/lib/ios-verification.mjs permit ${mode} "$MYBILL_FULL_ATTEMPT"
LOG="$MYBILL_FULL_ATTEMPT/build.log"
node scripts/lib/ios-verification.mjs phase ${mode} "$MYBILL_FULL_ATTEMPT" build check/app-build "$LOG"
node -e 'const fs=require("fs");const p=process.env.MYBILL_FULL_ATTEMPT+"/progress.json";const d=JSON.parse(fs.readFileSync(p));d.startedAt-=600001;fs.writeFileSync(p,JSON.stringify(d))'
sleep 5
echo SHOULD_NOT_CONTINUE > continued
`
    )
    const result = p.run([mode])
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /build 阶段超时/)
    assert.ok(fs.existsSync(path.join(p.root, 'cleanup-receipt')))
    assert.equal(fs.existsSync(path.join(p.root, 'continued')), false)
    assert.equal(fs.existsSync(path.join(p.base, 'ios-command.lock')), false)
    const run = fs.readdirSync(p.base).find((name) => name.startsWith('ios-command-'))
    const receipt = JSON.parse(fs.readFileSync(path.join(p.base, run, 'result.json')))
    assert.equal(receipt.scope, 'engineering')
    assert.equal(receipt.status, 'failed')
    assert.equal(receipt.timings[0].status, 'failed')
    assert.ok(receipt.timings[0].elapsedMs >= 600001)
    assert.equal(fs.existsSync(path.join(p.base, run, 'active.json')), false)
    assert.equal(fs.existsSync(path.join(p.base, 'ios-verification-state.json')), false)
  })
}

test('工程检查正常分阶段执行并保存耗时，错误模式许可被拒绝，不消耗完整验收次数', (t) => {
  const p = project(t)
  p.write(
    'scripts/lib/ios-app-full.sh',
    `#!/bin/bash
set -e
node scripts/lib/ios-verification.mjs permit common "$MYBILL_FULL_ATTEMPT"
if node scripts/lib/ios-verification.mjs permit ios-build "$MYBILL_FULL_ATTEMPT"; then exit 9; fi
node scripts/lib/ios-verification.mjs phase common "$MYBILL_FULL_ATTEMPT" build check/app-build "$MYBILL_FULL_ATTEMPT/build.log"
node scripts/lib/ios-verification.mjs phase common "$MYBILL_FULL_ATTEMPT" check check/resources/source "$MYBILL_FULL_ATTEMPT/resources.log"
`
  )
  const result = p.run(['common'])
  assert.equal(result.status, 0, result.stderr)
  const run = fs.readdirSync(p.base).find((name) => name.startsWith('ios-command-'))
  const receipt = JSON.parse(fs.readFileSync(path.join(p.base, run, 'result.json')))
  assert.equal(receipt.status, 'passed')
  assert.deepEqual(
    receipt.timings.map((phase) => phase.stage),
    ['build', 'check']
  )
  assert.equal(fs.existsSync(path.join(p.base, 'ios-verification-state.json')), false)
  assert.equal(fs.existsSync(path.join(p.base, run, 'active.json')), false)
  assert.throws(() => requireEvidence(p.root, path.join(p.base, run), inputHash(p.root), environment))
})

test('完整失败后局部发现另一层故障，两层相关修复均须覆盖', (t) => {
  clock(t)
  const p = project(t)
  const H = p.hash()
  finishAttempt(p, H, p.evidence())
  const otherKey = 'app-test/src/domain/money.spec.ts#money sum'
  const failed = p.evidence(target, {
    status: 'failed',
    failure: { required: [otherKey] }
  })
  recordLocal(p.root, failed.run, failed.result)
  const fixedUi = p.evidence()
  assert.throws(() => finishAttempt(p, H, fixedUi, false), /app-test/)
  const fixedNode = {
    run: 'controlled-node-proof',
    result: { ...p.context(), coverage: [otherKey], completedAt: Date.now() }
  }
  const retry = finishAttempt(p, H, [fixedUi, fixedNode], false)
  assert.equal(retry.retry, 1)
})

test('首次完整验证也拒绝用无关绿色跳过已观察到的局部失败', (t) => {
  clock(t)
  const p = project(t)
  const H = p.hash()
  const failed = p.evidence('template-tie', {
    status: 'failed',
    failure: { required: [scenarioKey('template-tie')] }
  })
  recordLocal(p.root, failed.run, failed.result)
  assert.throws(
    () => beginFull(p.root, 'ios-smoke', p.evidence('crud'), H, process.pid, p.context()),
    /template-tie/
  )
  const allowed = beginFull(p.root, 'ios-smoke', p.evidence('template-tie'), H, process.pid, p.context())
  finishFull(p.root, allowed)
})

test(
  '原生场景 CLI 把具体场景传入测试阶段及最终回执，受控工具替身不启动设备',
  { timeout: 15000, skip: process.platform !== 'darwin' },
  (t) => {
    const p = project(t)
    const executable = (name, source) => {
      const file = p.write('bin/' + name, source)
      fs.chmodSync(file, 0o755)
    }
    executable('plutil', '#!/bin/sh\nprintf "{}"\n')
    executable('python3', '#!/bin/sh\nprintf "ISOLATED_NATIVE_HOST_INITIALIZED"\n')
    // simctl 已退出，但辅助进程仍持有输出 FD；必须允许进入后续测试，不能等管道 EOF。
    // 辅助进程到达测试启动信号或 8 秒上限即退出，故障反例也不遗留进程。
    const startupSignal = path.join(p.root, 'test-started')
    const drainResult = path.join(p.root, 'output-drain-result')
    const helper = p.write('hold-output.cjs', `
const fs = require('node:fs')
const signal = ${JSON.stringify(startupSignal)}
const result = ${JSON.stringify(drainResult)}
const started = Date.now()
const timer = setInterval(() => {
  const ready = fs.existsSync(signal)
  if (ready || Date.now() - started > 8000) {
    fs.writeFileSync(result, ready ? 'test-started' : 'deadline')
    clearInterval(timer)
  }
}, 10)
`)
    const launcher = p.write('hold-output-launch.cjs', `
const { spawn } = require('node:child_process')
spawn(process.execPath, [${JSON.stringify(helper)}], { detached: true, stdio: ['ignore', 1, 2] }).unref()
`)
    const originalXcrun = fs.readFileSync(path.join(p.root, 'bin/xcrun'), 'utf8')
    executable('xcrun', `#!/bin/sh
if [ "$2" = terminate ]; then
  "${process.execPath}" "${launcher}"
  exit $?
fi
${originalXcrun.replace(/^#![^\n]*\n/, '')}`)
    executable(
      'xcodebuild',
      `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args.includes('-version')) {
  console.log('Xcode 27.0')
} else if (args[0] === 'build-for-testing') {
  const derived = args[args.indexOf('-derivedDataPath') + 1]
  const products = path.join(derived, 'Build/Products')
  fs.mkdirSync(path.join(products, 'Debug-iphonesimulator/App.app'), { recursive: true })
  fs.writeFileSync(path.join(products, 'Debug-iphonesimulator/App.app/App'), 'controlled fixture binary')
  fs.writeFileSync(path.join(products, 'App.xctestrun'), 'controlled fixture plan')
} else if (args[0] === 'test-without-building') {
  fs.writeFileSync(${JSON.stringify(startupSignal)}, 'started')
  const context = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(p.session, 'test-context.json'))}))
  console.log("Test Case '-[NativeTests.NativeSqliteTests testOfflineDictionaryScenario]' passed (0.1 seconds).")
  console.log('Executed 1 test, with 0 failures')
  console.log('NATIVE_DICTIONARY_SCENARIO_VERIFIED ' + context.scenario)
} else {
  process.exit(9)
}
`
    )
    const key = 'native-build/App/Debug'
    const full = beginFull(
      p.root,
      'ios-smoke',
      p.evidence('template-tie'),
      p.hash(),
      process.pid,
      p.context()
    )
    startPhase(full.run, { stage: 'build', coverage: [key] })
    finishFull(p.root, full, new Error('controlled full build failure'))
    const result = p.run(['debug', 'run', '--session', p.session, '--scenario', 'template-tie'])
    assert.equal(result.status, 0, result.stderr)
    const run = result.stdout.match(/^EVIDENCE=(.+)$/m)[1]
    assert.equal(fs.readFileSync(drainResult, 'utf8'), 'test-started', '初始化收尾不得等待辅助输出管道 EOF')
    assert.ok(fs.existsSync(path.join(run, 'initialize-launch.log')))
    assert.ok(fs.existsSync(path.join(run, 'stop-initialize.log')))
    const evidence = requireEvidence(p.root, run, inputHash(p.root), environment)
    assert.ok(evidence.result.coverage.includes(scenarioKey('template-tie')))
    assert.ok(!evidence.result.coverage.includes(scenarioKey('crud')))
    const phase = evidence.result.timings.find((item) => item.stage === 'test')
    assert.equal(phase.scenario, 'template-tie')
    assert.ok(phase.coverage.includes(scenarioKey('template-tie')))
    const second = p.run(['debug', 'run', '--session', p.session, '--scenario', 'crud'])
    assert.equal(second.status, 0, second.stderr)
    assert.match(second.stdout, /BUILD_CACHE_HIT/)
    const cachedRun = second.stdout.match(/^EVIDENCE=(.+)$/m)[1]
    assert.equal(requireEvidence(p.root, cachedRun, inputHash(p.root), environment).result.cacheHit, true)
    assert.equal(readState(p.root).attempts['ios-smoke'].status, 'failed')
    // 只使启动请求失败；缓存与设备归属不变，下一次修复不得重编或新建设备。
    executable('xcrun', `#!/bin/sh
if [ "$2" = launch ] && [ -f "${p.root}/fail-initialize" ]; then exit 9; fi
${originalXcrun.replace(/^#![^\n]*\n/, '')}`)
    p.write('fail-initialize', 'controlled launch failure')
    const launchFailure = p.run(['debug', 'run', '--session', p.session, '--scenario', 'crud'])
    assert.notEqual(launchFailure.status, 0)
    assert.match(launchFailure.stdout, /BUILD_LAYER_HIT native/)
    fs.unlinkSync(path.join(p.root, 'fail-initialize'))
    const repaired = p.run(['debug', 'run', '--session', p.session, '--scenario', 'crud'])
    assert.equal(repaired.status, 0, repaired.stderr)
    for (const layer of ['types', 'assets', 'probe', 'native'])
      assert.match(repaired.stdout, new RegExp('BUILD_LAYER_HIT ' + layer))
    const repairedRun = repaired.stdout.match(/^EVIDENCE=(.+)$/m)[1]
    assert.equal(fs.existsSync(path.join(repairedRun, 'build.log')), false)
    assert.equal(readState(p.root).attempts['ios-smoke'].status, 'failed', '局部修复不清除完整失败锁')
  }
)

test('UI 局部 CLI 只在夹具关闭后预启动，runner 准备复用前台 App，不扩大用例',
  { timeout: 15000, skip: process.platform !== 'darwin' }, t => {
    const p = project(t)
    const executable = (name, source) => {
      const file = p.write('bin/' + name, source)
      fs.chmodSync(file, 0o755)
    }
    const trace = path.join(p.root, 'ui-order.log')
    const originalXcrun = fs.readFileSync(path.join(p.root, 'bin/xcrun'), 'utf8')
    executable('xcrun', `#!/bin/sh
printf 'sim:%s\\n' "$2" >> "${trace}"
${originalXcrun.replace(/^#![^\n]*\n/, '')}`)
    executable('plutil', '#!/bin/sh\nprintf "{}"\n')
    executable('python3', `#!/bin/sh\nprintf 'python:%s\\n' "$2" >> "${trace}"\n`)
    executable('xcodebuild', `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), args = process.argv.slice(2)
if (args.includes('-version')) console.log('Xcode 27.0')
else if (args[0] === 'build-for-testing') {
  const products = path.join(args[args.indexOf('-derivedDataPath') + 1], 'Build/Products')
  for (const name of ['App.app', 'DictionaryUITests-Runner.app']) {
    fs.mkdirSync(path.join(products, 'Release-iphonesimulator', name), { recursive: true })
    fs.writeFileSync(path.join(products, 'Release-iphonesimulator', name, 'binary'), 'controlled bundle')
  }
  fs.writeFileSync(path.join(products, 'DictionaryTouch.xctestrun'), 'controlled plan')
} else if (args[0] === 'test-without-building') {
  fs.appendFileSync(${JSON.stringify(trace)}, 'test\\n')
  console.log("Test Case '-[DictionaryUITests.DictionaryTouchTests test00PrepareReportApp]' passed (0.1 seconds).")
  console.log('Executed 1 test, with 0 failures')
} else process.exit(9)
`)
    const leaseFile = path.join(p.session, 'ui-install.json')
    const context = JSON.parse(fs.readFileSync(path.join(p.session, 'test-context.json')))
    const invalidLease = JSON.stringify({ runId: randomUUID(), simulatorId: context.simulatorId,
      appId: APP_ID, container: '/other-scope', appHash: 'a'.repeat(64) })
    fs.writeFileSync(leaseFile, invalidLease, { mode: 0o600 })
    const rejected = p.run(['debug', 'run', '--session', p.session, '--case', ui('test00PrepareReportApp')])
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /安装回执与本会话不匹配/)
    assert.equal(fs.readFileSync(leaseFile, 'utf8'), invalidLease)
    assert.doesNotMatch(fs.readFileSync(trace, 'utf8'), /sim:(uninstall|install)/,
      '坏归属不能降级成冷安装并清除数据')
    fs.unlinkSync(leaseFile)
    const result = p.run(['debug', 'run', '--session', p.session, '--case', ui('test00PrepareReportApp')])
    assert.equal(result.status, 0, result.stderr)
    const lines = fs.readFileSync(trace, 'utf8').trim().split('\n')
    const fixture = lines.indexOf('python:debug-report-42')
    assert.ok(fixture >= 0)
    assert.deepEqual(lines.slice(fixture + 1, lines.indexOf('test')), ['sim:launch'],
      '夹具完成后启动且保持前台，不在 runner 之前再次终止')
    const run = result.stdout.match(/^EVIDENCE=(.+)$/m)[1]
    assert.equal(JSON.parse(fs.readFileSync(path.join(run, 'result.json'))).executedCases.length, 1)
  })

test('runner 安装失败后 App 回执仍有效，重试只装 runner；旧整体安装失败仍保留完整锁',
  { timeout: 30000, skip: process.platform !== 'darwin' }, t => {
    const p = runnerProject(t), key = 'native-install/DictionaryTouch/Release'
    p.write('fail-runner', 'controlled runner failure')
    const failed = p.run(p.args)
    assert.notEqual(failed.status, 0)
    const failedRun = fs.readdirSync(p.session).find(n => n.startsWith('run-'))
    const receipt = JSON.parse(fs.readFileSync(path.join(p.session, failedRun, 'result.json')))
    assert.deepEqual(receipt.failure.required, [key + '/runner'])
    assert.ok(fs.existsSync(path.join(p.session, 'ui-install.json')), 'App 已成功，不因 runner 失败丢回执')
    fs.unlinkSync(path.join(p.root, 'fail-runner'))
    const fixed = p.run(p.args)
    assert.equal(fixed.status, 0, fixed.stderr)
    const run = fixed.stdout.match(/^EVIDENCE=(.+)$/m)[1]
    const proof = requireEvidence(p.root, run, inputHash(p.root), environment)
    assert.equal(proof.result.installationReused, true)
    assert.equal(proof.result.runnerInstallationReused, false)
    assert.ok(proof.result.coverage.includes(key + '/runner'))
    assert.ok(!proof.result.coverage.includes(key + '/app'))
    assert.ok(!proof.result.coverage.includes(key), '只修 runner 不冒充完整安装修复')
    assert.deepEqual(JSON.parse(fs.readFileSync(p.trace)), ['install-App', 'install-runner', 'install-runner'])
    const full = beginFull(p.root, 'ios-touch', proof, p.hash(), process.pid, p.context())
    startPhase(full.run, { stage: 'install', coverage: [key] })
    finishFull(p.root, full, new Error('legacy install failure'))
    const legacy = p.run(p.args)
    assert.equal(legacy.status, 0, legacy.stderr)
    const legacyRun = legacy.stdout.match(/^EVIDENCE=(.+)$/m)[1]
    assert.ok(requireEvidence(p.root, legacyRun, inputHash(p.root), environment).result.coverage.includes(key))
    assert.equal(readState(p.root).attempts['ios-touch'].status, 'failed')
    const cached = p.run(p.args)
    assert.equal(cached.status, 0, cached.stderr)
    assert.match(cached.stdout, /INSTALL_APP_HIT; RUNNER_HIT/)
    const trace = JSON.parse(fs.readFileSync(p.trace))
    assert.equal(trace.filter(x => x === 'install-App').length, 2, '整体失败修复后再次恢复缓存')
    assert.ok(!trace.includes('uninstall-App'))
    p.write(path.relative(p.root, path.join(p.session, 'ui-reset.json')), 'old-install-reset')
    p.write('app/src/view.vue', 'new App candidate')
    const changed = p.run(p.args)
    assert.equal(changed.status, 0, changed.stderr)
    assert.equal(fs.existsSync(path.join(p.session, 'ui-reset.json')), false, '冷安装不继承旧包的重置断点')
    assert.ok(JSON.parse(fs.readFileSync(p.trace)).includes('uninstall-App'))
  })

test('新候选 App 在卸载前拒绝错误沙盒回执，保留有效安装、基线和中断日志',
  { timeout: 30000, skip: process.platform !== 'darwin' }, t => {
    const p = runnerProject(t)
    const initial = p.run(p.args)
    assert.equal(initial.status, 0, initial.stderr)
    const leaseFile = path.join(p.session, 'ui-install.json')
    const lease = JSON.parse(fs.readFileSync(leaseFile))
    p.write('app/src/view.vue', 'new candidate requiring cold installation')
    const baseline = p.write(path.relative(p.root, path.join(p.session, 'ui-baseline/keep')), 'baseline sentinel')
    const journal = p.write(path.relative(p.root, path.join(p.session, 'ui-reset.json')), 'pending reset sentinel')
    const before = fs.readFileSync(p.trace, 'utf8')
    for (const patch of [
      { container: '/foreign-container' },
      { container: lease.container.replace(lease.simulatorId, randomUUID()) },
      { appHash: 'f'.repeat(64) }
    ]) {
      const invalid = JSON.stringify({ ...lease, ...patch })
      fs.writeFileSync(leaseFile, invalid)
      const rejected = p.run(p.args)
      assert.notEqual(rejected.status, 0)
      assert.match(rejected.stderr, /安装回执.*拒绝/)
      assert.equal(fs.readFileSync(leaseFile, 'utf8'), invalid)
      assert.equal(fs.readFileSync(p.trace, 'utf8'), before, '卸载/安装前拒绝')
      assert.equal(fs.readFileSync(baseline, 'utf8'), 'baseline sentinel')
      assert.equal(fs.readFileSync(journal, 'utf8'), 'pending reset sentinel')
    }
    // 同设备另一 UUID 也不能凭路径形状通过：须实际完成基线重绑。
    fs.writeFileSync(leaseFile, JSON.stringify({ ...lease, container: path.join(path.dirname(lease.container), randomUUID()) }))
    const unbound = p.run(p.args)
    assert.notEqual(unbound.status, 0)
    assert.match(unbound.stderr, /沙盒重绑未确认/)
    assert.equal(fs.readFileSync(p.trace, 'utf8'), before)
    // 模拟基线工具已核实同一数据集的合法搬迁；必须使用旧安装摘要，而非新候选摘要。
    const python = p.write('bin/python3', '#!' + process.execPath + '\n' + `
const fs=require('node:fs'),a=process.argv.slice(2)
if(a[2]==='rebind'){
 if(a[5]!==${JSON.stringify(lease.appHash)})process.exit(9)
 const file=${JSON.stringify(leaseFile)},value=JSON.parse(fs.readFileSync(file))
 fs.writeFileSync(file,JSON.stringify({...value,container:a[4]}))
}
`)
    fs.chmodSync(python, 0o755)
    const accepted = p.run(p.args)
    assert.equal(accepted.status, 0, accepted.stderr)
    const acceptedRun = accepted.stdout.match(/^EVIDENCE=(.+)$/m)[1]
    assert.equal(JSON.parse(fs.readFileSync(path.join(acceptedRun, 'result.json'))).containerRebound, true)
    assert.equal(JSON.parse(fs.readFileSync(p.trace)).filter(x => x === 'uninstall-App').length, 1,
      '确认同一旧安装的合法搬迁后允许新包冷安装')
  })

for (const failProbe of [false, true]) {
  test(`同会话 UI/Release→App/Debug→UI/Release 统一登记且热缓存恢复，探针安装失败=${failProbe}`,
    { timeout: 30000, skip: process.platform !== 'darwin' }, t => {
      const p = runnerProject(t), leaseFile = path.join(p.session, 'ui-install.json')
      const probeArgs = ['debug', 'run', '--session', p.session, '--case',
        'NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection']
      const run = args => {
        const result = p.run(args)
        assert.equal(result.status, 0, result.stderr)
        return JSON.parse(fs.readFileSync(path.join(result.stdout.match(/^EVIDENCE=(.+)$/m)[1], 'result.json')))
      }
      run(p.args)
      const release = JSON.parse(fs.readFileSync(leaseFile))
      if (failProbe) {
        p.write('fail-app', 'controlled failed install after owned uninstall')
        const failed = p.run(probeArgs)
        assert.notEqual(failed.status, 0)
        assert.equal(fs.existsSync(leaseFile), false, '已卸载的旧 App 不留错误登记')
        fs.unlinkSync(path.join(p.root, 'fail-app'))
      }
      const probe = run(probeArgs), debug = JSON.parse(fs.readFileSync(leaseFile))
      assert.notEqual(debug.appHash, release.appHash, 'Debug 与 Release 为真实不同的受控包')
      assert.equal(debug.container, p.container)
      assert.equal(probe.fixtureBaselineReused, false, '新包重新捕获空基线')
      const returned = run(p.args)
      assert.equal(JSON.parse(fs.readFileSync(leaseFile)).appHash, release.appHash)
      assert.equal(returned.buildLayers.native, true, '返回 UI 复用 Release 原生产物')
      assert.equal(returned.fixtureBaselineReused, false, '不继承 Debug 数据初态')
      const hot = run(p.args)
      assert.equal(hot.installationReused, true)
      for (const key of ['types', 'assets', 'native']) assert.equal(hot.buildLayers[key], true)
      const before = fs.readFileSync(p.trace, 'utf8')
      fs.writeFileSync(leaseFile, JSON.stringify({ ...release, container: '/wrong-scope' }))
      for (const args of [probeArgs, p.args]) {
        const rejected = p.run(args)
        assert.notEqual(rejected.status, 0)
        assert.match(rejected.stderr, /安装回执沙盒路径.*拒绝/)
        assert.equal(fs.readFileSync(p.trace, 'utf8'), before, '两种方案均在安装/卸载前拒绝')
      }
    })
}

test('完整入口借用会话共用安装校验，只有卸载成功才失效登记，不误拦返回局部',
  { timeout: 20000, skip: process.platform !== 'darwin' }, t => {
    const p = runnerProject(t)
    assert.equal(p.run(p.args).status, 0)
    const leaseFile = path.join(p.session, 'ui-install.json'), lease = JSON.parse(fs.readFileSync(leaseFile))
    const context = JSON.parse(fs.readFileSync(path.join(p.session, 'test-context.json')))
    // 仅执行实际完整脚本中的借用重置块，不编译或运行完整验收。
    const shell = fs.readFileSync(path.join(p.root, 'scripts/lib/ios-app-full.sh'), 'utf8')
    const code = shell.split('node --input-type=module - "${MYBILL_FULL_SESSION}" "${SIMULATOR_ID}" "${INSTALLED}" <<\'JS\'\n')[1]?.split('\nJS')[0]
    assert.ok(code)
    const reset = () => spawnSync(process.execPath, ['--input-type=module', '-', p.session, context.simulatorId, 'true'], {
      cwd: p.root, input: code, encoding: 'utf8', env: { ...process.env,
        PATH: path.join(p.root, 'bin') + path.delimiter + process.env.PATH }
    })
    const marker = p.write(path.relative(p.root, path.join(p.session, 'ui-baseline/marker')), 'old baseline')
    const journal = p.write(path.relative(p.root, path.join(p.session, 'ui-reset.json')), 'pending reset')
    const stateFile = path.join(p.base, 'ios-verification-state.json'), state = fs.readFileSync(stateFile)
    const before = fs.readFileSync(p.trace, 'utf8')
    fs.writeFileSync(leaseFile, JSON.stringify({ ...lease, appHash: 'f'.repeat(64) }))
    const invalid = reset()
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stderr, /安装回执与已安装 App 不匹配/)
    assert.equal(fs.readFileSync(p.trace, 'utf8'), before)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'old baseline')
    fs.writeFileSync(leaseFile, JSON.stringify(lease))
    p.write('fail-uninstall', 'controlled uninstall failure')
    assert.notEqual(reset().status, 0)
    assert.deepEqual(JSON.parse(fs.readFileSync(leaseFile)), lease)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'old baseline')
    assert.equal(fs.readFileSync(journal, 'utf8'), 'pending reset')
    fs.unlinkSync(path.join(p.root, 'fail-uninstall'))
    const accepted = reset()
    assert.equal(accepted.status, 0, accepted.stderr)
    for (const file of [leaseFile, path.dirname(marker), journal]) assert.equal(fs.existsSync(file), false)
    assert.deepEqual(fs.readFileSync(stateFile), state, '不清除完整失败锁与历史')
    assert.equal(p.run(p.args).status, 0, '返回局部按冷路径建立新登记')
  })

test('完整触摸每组停止后重新查询沙盒，迁移不沿用旧回读路径，停止/查询失败均阻断', t => {
  const p = project(t), shell = fs.readFileSync(path.join(p.root, 'scripts/lib/ios-app-full.sh'), 'utf8')
  const body = shell.match(/    stop_owned_app\(\) \{([\s\S]*?)\n    \}/)?.[1]
  assert.ok(body)
  const xcrun = p.write('bin/xcrun', '#!/bin/sh\n' + `
if [ "$2" = terminate ]; then
 if [ -f fail-stop ]; then exit 9; fi
 if [ -f no-host ]; then echo 'found nothing to terminate' >&2; exit 3; fi
elif [ "$2" = get_app_container ]; then
 if [ -f fail-query ]; then exit 9; fi
 cat current-container
fi
`)
  fs.chmodSync(xcrun, 0o755)
  const run = () => spawnSync('bash', ['-s'], { cwd: p.root, encoding: 'utf8', env: { ...process.env,
    PATH: path.join(p.root, 'bin') + path.delimiter + process.env.PATH }, input: `set -euo pipefail
SIMULATOR_ID=owned-test-device
APP_CONTAINER=old-container
stop_owned_app() {${body}
}
stop_owned_app stop.log
printf 'READBACK=%s\\n' "$APP_CONTAINER"
` })
  for (const group of ['entry', 'personal', 'lifecycle', 'query', 'report']) {
    p.write('current-container', 'migrated-' + group)
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, new RegExp('READBACK=migrated-' + group))
  }
  p.write('no-host', '')
  assert.equal(run().status, 0, '已结束宿主的明确 ESRCH 仍可回读当前路径')
  for (const flag of ['fail-stop', 'fail-query']) {
    p.write(flag, '')
    const rejected = run()
    assert.notEqual(rejected.status, 0)
    assert.doesNotMatch(rejected.stdout, /READBACK=/)
    fs.unlinkSync(path.join(p.root, flag))
  }
})

test('App 与 runner 分开计时仍共用两分钟安装预算，不因换组件延长', t => {
  const p = project(t), run = fs.mkdtempSync(path.join(p.base, 'ios-full-'))
  let time = 0
  t.mock.method(Date, 'now', () => time)
  const observer = observeFull({ run, root: p.root }, { now: () => time })
  startPhase(run, { stage: 'install', coverage: ['native-install/DictionaryTouch/Release/app'] })
  time = 70000
  observer.poll()
  startPhase(run, { stage: 'install', coverage: ['native-install/DictionaryTouch/Release/runner'], budgetMs: 50000 })
  time = 120001
  assert.throws(() => observer.poll(), /install 阶段超时/)
  startPhase(run, { stage: 'install', coverage: ['native-install/DictionaryTouch/Release/runner'], budgetMs: 120001 })
  assert.throws(() => observer.poll(), /预算不合法/)
})

for (const phase of ['build', 'install', 'initialize']) {
  test(`完整 ${phase} 失败后的相关局部成功恢复缓存，失败锁和复验次数仍保留`, (t) => {
    clock(t)
    const p = project(t)
    const H = p.hash()
    const key = `native-${phase}/App/Debug`
    const native = 'NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection'
    const old = p.evidence(native)
    const full = beginFull(p.root, 'ios-smoke', old, H, process.pid, p.context())
    startPhase(full.run, { stage: phase, coverage: [key] })
    finishFull(p.root, full, new Error('controlled full phase failure'))
    const check = () => needsPhaseRepair(p.root, key, environment)
    assert.equal(check(), true)
    for (const overrides of [
      { coverage: ['native-build/DictionaryTouch/Release'] },
      { completedAt: full.startedAt - 1 },
      { inputHash: 'old-input' },
      { environment: 'another-runtime' },
      { scope: 'engineering' }
    ]) {
      const unrelated = p.evidence(native, { coverage: [caseKey(native), key], ...overrides })
      recordLocal(p.root, unrelated.run, unrelated.result)
      assert.equal(check(), true)
    }
    const repaired = p.evidence(native, { coverage: [caseKey(native), key] })
    recordLocal(p.root, repaired.run, repaired.result)
    assert.equal(check(), false)
    const older = p.evidence(native, { coverage: [caseKey(native), key], completedAt: full.startedAt - 1 })
    recordLocal(p.root, older.run, older.result)
    assert.equal(check(), false)
    assert.equal(readState(p.root).attempts['ios-smoke'].status, 'failed')
    assert.throws(() => beginFull(p.root, 'ios-touch', repaired, H, process.pid, p.context()), /先处理/)
    assert.throws(() => beginFull(p.root, 'ios-smoke', old, H, process.pid, p.context()), /相关局部/)
    p.write('app/src/view.vue', 'another input')
    assert.equal(check(), true)
    p.write('app/src/view.vue', 'fixture')
    assert.equal(check(), false)
    const retry = beginFull(p.root, 'ios-smoke', repaired, H, process.pid, p.context())
    startPhase(retry.run, { stage: phase, coverage: [key] })
    finishFull(p.root, retry, new Error('same phase failed again'))
    assert.equal(check(), true)
    const fixedAgain = p.evidence(native, { coverage: [caseKey(native), key] })
    recordLocal(p.root, fixedAgain.run, fixedAgain.result)
    assert.equal(check(), false)
    assert.throws(
      () => beginFull(p.root, 'ios-smoke', fixedAgain, H, process.pid, p.context()),
      /初验及一次复验/
    )
  })
}

test('单调整轮截止时间累计工具链及执行耗时，不受系统日期回拨影响', (t) => {
  let elapsed = 0
  const deadline = createDeadline(totalBudgets.acceptance, { now: () => elapsed })
  for (let i = 0; i < 3; i++) {
    elapsed += 240000
    assert.equal(deadline.remaining(), 900000 - elapsed)
  }
  t.mock.method(Date, 'now', () => 0)
  elapsed += 170000
  assert.equal(deadline.remaining(), 10000)
  elapsed += 10000
  assert.throws(() => deadline.remaining(), /整轮执行超时/)
  assert.deepEqual(deadline.snapshot(), { budgetMs: 900000, elapsedMs: 900000 })
  const engineering = createDeadline(totalBudgets.engineering, { now: () => 0 })
  assert.equal(engineering.remaining(), 2400000)
})

// 只推进单调时钟，不真实等待分钟数；每个受控步骤均低于其单独的子命令上限。
function virtualClock(p, durations) {
  return p.write(
    '.local/ios/virtual-clock.mjs',
    `
import cp from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { syncBuiltinESMExports } from 'node:module'
const originalNow = performance.now.bind(performance)
let elapsed = 0
Object.defineProperty(performance, 'now', { value: () => originalNow() + elapsed })
const spawn = cp.spawn
cp.spawn = (program, args, options) => {
  const child = spawn(program, args, options)
  const values = ${JSON.stringify(durations)}
  const duration = program === 'xcrun' || program === 'xcodebuild' ? values.toolchain
    : program === 'bash' && args[0] === '-n' ? values.syntax : program === 'bash' && args[0] === '-s' ? values.body : 0
  const once = child.once.bind(child)
  child.once = (event, fn) => once(event, event === 'close' ? (...args) => {
    elapsed += duration
    fn(...args)
  } : fn)
  return child
}
syncBuiltinESMExports()
`
  )
}

for (const kind of ['preflight', 'execution', 'within-budget']) {
  test(`真实 CLI 从入口累计整轮预算：${kind}，留下独立回执且不会误记通过`, { timeout: 15000 }, (t) => {
    const p = project(t)
    p.write('scripts/lib/ios-app-full.sh', '#!/bin/bash\nexit 0\n')
    const proof = p.evidence('NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection')
    const durations =
      kind === 'preflight'
        ? { syntax: 240000, toolchain: 240000, body: 0 }
        : kind === 'execution'
          ? { syntax: 0, toolchain: 240000, body: 300000 }
          : { syntax: 0, toolchain: 100000, body: 100000 }
    const preload = virtualClock(p, durations)
    const result = p.run(['ios-smoke', '--from', proof.run], {
      DEVELOPER_DIR: '/controlled/sdk',
      NODE_OPTIONS: '--import=' + preload
    })
    const passed = kind === 'within-budget'
    assert.equal(result.status, passed ? 0 : 1, result.stderr)
    if (!passed) assert.match(result.stderr, /整轮执行超时/)
    const directory = fs.readdirSync(p.base).find((name) => name.startsWith('ios-invocation-'))
    const receipt = JSON.parse(fs.readFileSync(path.join(p.base, directory, 'result.json')))
    assert.equal(receipt.status, passed ? 'passed' : 'failed')
    assert.equal(receipt.deadline.budgetMs, 900000)
    assert.ok(receipt.deadline.elapsedMs >= (passed ? 400000 : 900000))
    assert.equal(receipt.phase, kind === 'preflight' ? 'preflight' : 'execution')
    assert.equal(fs.existsSync(path.join(p.base, 'ios-command.lock')), false)
    if (kind === 'preflight') {
      assert.equal(fs.existsSync(path.join(p.base, 'ios-verification-state.json')), false)
      assert.equal(
        fs.readdirSync(p.base).some((name) => name.startsWith('ios-full-')),
        false
      )
    } else {
      assert.equal(readState(p.root).attempts['ios-smoke'].status, passed ? 'passed' : 'failed')
    }
  })
}

test('前置检查消耗的预算会缩短活动子进程的剩余时间，超时立即取消并清理', { timeout: 15000 }, (t) => {
  const p = project(t)
  p.write(
    'scripts/lib/ios-app-full.sh',
    `#!/bin/bash
trap 'echo cleaned > cleanup-receipt; exit 143' TERM INT
sleep 5
echo SHOULD_NOT_CONTINUE > continued
`
  )
  const proof = p.evidence('NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection')
  const preload = virtualClock(p, { syntax: 0, toolchain: 299000, body: 0 })
  const result = p.run(['ios-smoke', '--from', proof.run], {
    DEVELOPER_DIR: '/controlled/sdk',
    NODE_OPTIONS: '--import=' + preload
  })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /整轮执行超时/)
  assert.ok(fs.existsSync(path.join(p.root, 'cleanup-receipt')))
  assert.equal(fs.existsSync(path.join(p.root, 'continued')), false)
  assert.equal(fs.existsSync(path.join(p.base, 'ios-command.lock')), false)
  const directory = fs.readdirSync(p.base).find((name) => name.startsWith('ios-invocation-'))
  const receipt = JSON.parse(fs.readFileSync(path.join(p.base, directory, 'result.json')))
  assert.equal(receipt.status, 'failed')
  assert.ok(receipt.deadline.elapsedMs >= receipt.deadline.budgetMs)
})

test(
  '创建失败补偿共享 10 秒清理预算，耗尽时不再叠加一次强杀宽限',
  {
    timeout: 15000,
    skip: process.platform !== 'darwin'
  },
  (t) => {
    const p = project(t)
    const xcrun = p.write(
      'bin/xcrun',
      `#!/bin/sh
if [ "$2" = "create" ]; then exit 1; fi
if [ "$3" = "devices" ]; then trap '' TERM; sleep 5; exit 1; fi
if [ "$1" = "simctl" ]; then
  printf '%s\\n' '{"runtimes":[{"identifier":"com.apple.CoreSimulator.SimRuntime.iOS-27-0","isAvailable":true,"buildversion":"TEST"}]}'
else
  printf '27.0\\n'
fi
`
    )
    fs.chmodSync(xcrun, 0o755)
    const timers = path.join(p.base, 'cleanup-timers.jsonl')
    const preload = p.write(
      '.local/ios/cleanup-clock.mjs',
      `
import fs from 'node:fs'
const original = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...args) => {
  fs.appendFileSync(${JSON.stringify(timers)}, JSON.stringify(ms) + '\\n')
  return original(fn, ms === 10000 ? 10 : ms, ...args)
}
`
    )
    const result = p.run(['debug', 'create'], {
      DEVELOPER_DIR: '/controlled/sdk',
      NODE_OPTIONS: '--import=' + preload
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /创建补偿失败/)
    const delays = fs.readFileSync(timers, 'utf8').trim().split('\n').map(JSON.parse)
    assert.ok(delays.includes(10000))
    assert.equal(delays.at(-1), 0)
    assert.equal(fs.existsSync(path.join(p.base, 'ios-command.lock')), false)
  }
)
