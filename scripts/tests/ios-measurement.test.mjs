import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { recordLocal, readState, inputHash, controlInputs, requireEvidence } from '../lib/ios-verification.mjs'
import { swiftCaseInput, runtimeEquivalent, relevantChange, suiteMeasurement, caseMeasurement, prepareTrustedParser } from '../lib/ios-measurement-scope.mjs'
import { partialMeasurement, partialRuns, aggregatePartials, partialSeal, registerPartial, partialFailureStatus, finishPartialMeasurement, validateLocalPartial } from '../lib/ios-local-partials.mjs'
import { legacyProducerSource, scopedSource } from '../lib/ios-scenario-dependencies.mjs'
import { selection } from '../lib/ios-debug.mjs'
import { executeGroup, resultsDirectory, validateSuiteEvidence } from '../lib/ios-ci-run.mjs'
import { createPlan, registry, selectSuites, requiredLocalFromPolicies, digest, assertMeasuredPlan } from '../lib/ios-ci-plan.mjs'
import { uiReadbackMarkers, assertUiReadback, assertUiInteractionLog } from '../lib/ios-ui-readback.mjs'
import { automaticLocalGate, requiredLocalSuites } from '../lib/ios-local-delivery.mjs'
import { layerInputs } from '../lib/ios-cache.mjs'
import { equivalentCaseInputs, equivalentSuiteInputs } from '../lib/ios-equivalent-evidence.mjs'
import { scaleProtocolFixture } from '../lib/ios-scale-test-fixture.mjs'

const repository = new URL('../../', import.meta.url).pathname
const swiftFile = 'app/ios/App/UITests/DictionaryTouchTests.swift'
const swift = `import XCTest
final class DictionaryTouchTests: XCTestCase {
 let appID = "original"
 override func setUpWithError() throws { shared() }
 override func tearDownWithError() throws { }
 private func shared() { print("shared") }
 private func cancelOnly() { print("cancel") }
 func test08MergeCancel() { cancelOnly() }
 func test09MergeConfirm() { print("confirm") }
 func test10RelaunchedMergeCandidates() { print("readback") }
}
`
const ids = ['test08MergeCancel', 'test09MergeConfirm', 'test10RelaunchedMergeCandidates'].map(n => 'DictionaryUITests/DictionaryTouchTests/' + n)
const suite = { name: 'ui-merge', kind: 'ui', runner: 'macos', scenario: 'merge-cycle', description: 'merge' }
const environment = { sdk: '27.0', xcode: 'Xcode 27.0', runtime: 'test' }
function fixture(t, git = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ios-measurement-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (name, value) => {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 }); return file
  }
  write(swiftFile, git ? fs.readFileSync(path.join(repository, swiftFile), 'utf8') : swift)
  write('app/native-tests/scenarios.json', [])
  write('app/src/baseline.ts', 'export const baseline = 1')
  // Explicit adapter-free legacy route; absence of the adapter alone is not proof.
  write('scripts/lib/ios-local-partials.mjs', "export { partialMeasurement, registerPartial } from './ios-local-measurement.mjs'\n")
  write('scripts/lib/ios-local-measurement.mjs','export function partialMeasurement() {}\nexport function registerPartial() {}\n')
  const command = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim()
  if (git) {
    command('init', '-q'); command('config', 'user.name', 'test'); command('config', 'user.email', 'test@example.invalid')
    write('.gitignore', '.local/\n'); write('config/ios-ci.json', fs.readFileSync(path.join(repository, 'config/ios-ci.json'), 'utf8'))
    write('app/package-lock.json', { packages: {} })
  }
  const commit = () => { command('add', '.'); command('-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'); return command('rev-parse', 'HEAD') }
  const base = '.local/ios/tmp/ai-agent/ios-debug-fixture'
  const context = { kind: 'ios-debug', schema: 1, state: 'closed', appId: 'com.mybill.offline', simulatorId: randomUUID(), runId: randomUUID(), name: '我的账单调试-' + 'owned' }
  context.name = '我的账单调试-' + context.runId
  write(base + '/test-context.json', context)
  const session = { directory: path.join(root, base), context }
  return { root, write, command, commit, session, base }
}
function proof(p, name, kind, target, time, changes = {}) {
  const selected = selection('--' + kind, target, [])
  const relative = p.base + '/run-' + name, run = path.join(p.root, relative)
  const invocation = '.local/ios/tmp/ai-agent/ios-invocation-' + name + '/result.json'
  p.write(invocation,{scope:'invocation',mode:'debug run',status:'passed',startedAt:time-1,finishedAt:time+2,ownerPid:999999})
  const m = { ...partialMeasurement(p.root, selected, JSON.stringify(environment), p.session), invocation, startedAt: time, baseline: 'b'.repeat(64), ...changes }
  p.write(relative + '/local-measurement.json', m)
  p.write(relative + '/test.log', selected.cases.map(id => `Test Case '-[DictionaryUITests.DictionaryTouchTests ${id.split('/').at(-1)}]' passed (1 seconds).`).join('\n') + `\nExecuted ${selected.cases.length} tests, with 0 failures\n`)
  if (selected.cases.length === 1) p.write(relative + '/test.log', `Test Case '-[DictionaryUITests.DictionaryTouchTests ${selected.cases[0].split('/').at(-1)}]' passed (1 seconds).\nExecuted 1 test, with 0 failures\n`)
  p.write(relative + '/readback.log', uiReadbackMarkers(selected).join('\n') + '\n')
  p.write(relative + '/fixture.json', { source: 'owned-synthetic' })
  const result = { scope: 'partial', requested: { kind, name: target }, executedCases: selected.cases,
    configuration: 'Release', status: 'passed', inputHash: 'a'.repeat(64), environment: m.environment,
    runId: m.runId, simulatorId: m.simulatorId, completedAt: time + 1,
    coverage: [...selected.cases.map(id => 'case/' + id), 'native-readback/DictionaryTouch/Release'],
    timings: [{ stage: 'check', status: 'passed', coverage: ['native-readback/DictionaryTouch/Release'], log: path.join(run, 'readback.log') }],
  }
  result.measurementSeal = partialSeal(run, m, result)
  p.write(relative + '/result.json', result)
  return { run, measurement: m, result, relative }
}

test('专项粒度：Swift 叶子、共享调用、全局常量和未知语法保守失效', () => {
  const leaf = swift.replace('print("cancel")', 'print("changed")')
  assert.notEqual(swiftCaseInput(swift, 'test08MergeCancel'), swiftCaseInput(leaf, 'test08MergeCancel'))
  assert.equal(swiftCaseInput(swift, 'test09MergeConfirm'), swiftCaseInput(leaf, 'test09MergeConfirm'))
  for (const changed of [swift.replace('print("shared")', 'print("new")'), swift.replace('"original"', '"different"')])
    for (const id of ids) assert.notEqual(swiftCaseInput(swift, id.split('/').at(-1)), swiftCaseInput(changed, id.split('/').at(-1)))
  assert.notEqual(swiftCaseInput(swift, 'missing'), swiftCaseInput(leaf, 'missing'))
})

test('专项粒度：类型擦除不掩盖运行值变化、Vue 宏、删除及无法解析输入', () => {
  const a = 'import type { A } from "old"; export const value: A = 1'
  assert.equal(runtimeEquivalent('a.ts', a, a.replace('"old"', '"new"').replace(/\bA\b/g, 'B')), true)
  assert.equal(runtimeEquivalent('a.ts', a, a.replace('= 1', '= 2')), false)
  assert.equal(runtimeEquivalent('props.ts', 'export interface Props { value: string }', 'export interface Props { value: number }'), false, '导出类型可能参与另一文件的 Vue 宏')
  assert.equal(runtimeEquivalent('a.ts', 'export const value = `a b`', 'export const value = `ab`'), false)
  for (const [file,before,after] of [['a.vue',a,a],['a.ts',null,a],['a.ts',a,'not valid ::::']])
    assert.equal(runtimeEquivalent(file,before,after), false)
})

test('专项粒度：同文件单例不全选 UI、外部 UI 测试不触发 SQLite、共享辅助不漏消费者', () => {
  const r = JSON.parse(fs.readFileSync(path.join(repository, 'config/ios-ci.json')))
  const actual = fs.readFileSync(path.join(repository, swiftFile), 'utf8')
  const change = after => new Map([[swiftFile, { before: actual, after }]])
  const r2 = structuredClone(r)
  r2.suites['ui-merge'].scenario = 'merge-cycle'
  const names = changes => selectSuites(r2, 'change', [swiftFile], { execution: 'local', changes }).map(s => s.name)
  const leaf = names(change(actual.replace('func test08MergeCancel() {', 'func test08MergeCancel() { print("changed");')))
  assert.ok(leaf.includes('ui-merge')); assert.ok(!leaf.includes('native-sqlite')); assert.ok(!leaf.includes('ui-entry'))
  const shared = names(change(actual.replace('private func appears(_ label: String, timeout: TimeInterval = 10, containing: Bool = false) {', 'private func appears(_ label: String, timeout: TimeInterval = 10, containing: Bool = false) { print("changed");')))
  assert.ok(shared.includes('ui-merge') && shared.includes('ui-entry'))
  const unknown = names(undefined); assert.ok(unknown.includes('native-sqlite') && unknown.includes('ui-entry'))
  assert.equal(relevantChange(suite, 'a.ts', new Map([['a.ts',{before:'export const a: string = "x"',after:'export const a: unknown = "x"'}]])), false)
})

test('专项粒度：工具单测/文档不使原生证据失效，真实执行器、夹具、资源和 Vitest 输入仍失效', t => {
  const p = fixture(t), boot = { kind: 'environment' }, sqlite = { kind: 'full', mode: 'ios-smoke' }
  const initial = suiteMeasurement(p.root, boot), native = suiteMeasurement(p.root, sqlite), ui = caseMeasurement(p.root, ids[0])
  p.write('scripts/tests/example.test.mjs', '// regression'); p.write('README.md','docs'); p.write('app/src/example.spec.ts','test')
  assert.equal(suiteMeasurement(p.root,boot),initial); assert.equal(suiteMeasurement(p.root,sqlite),native); assert.equal(caseMeasurement(p.root,ids[0]),ui)
  p.write('app/vitest.config.ts','config')
  assert.equal(suiteMeasurement(p.root,boot),initial); assert.notEqual(suiteMeasurement(p.root,sqlite),native)
  p.write('scripts/fixtures/dictionary-touch.py','fixture')
  assert.notEqual(caseMeasurement(p.root,ids[0]),ui)
  p.write('scripts/lib/ios-processes.mjs','changed launcher'); assert.notEqual(suiteMeasurement(p.root,boot),initial)
  const ownerBefore=caseMeasurement(p.root,ids[0]); p.write('app/ios/App/NativeTests/OwnedSimulatorTestContext.swift','changed ownership'); assert.notEqual(caseMeasurement(p.root,ids[0]),ownerBefore)
})

test('局部汇总：两份实际范围补齐套件，重读原日志且不改写证据或失败锁', t => {
  const p = fixture(t), time = Date.now()-1000
  const a = proof(p,'a','case',ids[0],time), b = proof(p,'b','scenario','merge-relaunch',time+10)
  const original = fs.readFileSync(path.join(a.run,'result.json'))
  const originalLock=JSON.stringify({schema:2,attempts:{},history:[{mode:'ios-touch',status:'failed'}],localFailures:{},cacheRepairs:{}})
  const lock = p.write('.local/ios/tmp/ai-agent/ios-verification-state.json',originalLock)
  const rows = partialRuns(p.root).rows
  assert.equal(aggregatePartials(p.root,suite,environment,[rows[0]]).status,'not-verified')
  const result = aggregatePartials(p.root,suite,environment,rows)
  assert.equal(result.status,'passed',JSON.stringify(result.errors)); assert.equal(result.proofs.length,3); assert.deepEqual(result.missingCases,[])
  assert.deepEqual(fs.readFileSync(path.join(a.run,'result.json')),original); assert.equal(fs.readFileSync(lock,'utf8'),originalLock)
  fs.appendFileSync(path.join(b.run,'readback.log'),'tampered')
  assert.equal(aggregatePartials(p.root,suite,environment,rows).status,'not-verified')
})

test('局部汇总：不同数据基线/会话/环境不能拼接，旧输入及无摘要旧回执拒绝', t => {
  const p = fixture(t), time = Date.now()-1000
  const a = proof(p,'a','case',ids[0],time), b = proof(p,'b','scenario','merge-relaunch',time+10)
  for (const changes of [{baseline:'c'.repeat(64)},{runId:randomUUID()},{environment:JSON.stringify({sdk:'other'})},{host:'invalid'}]) {
    const m = {...b.measurement,...changes}
    assert.equal(aggregatePartials(p.root,suite,environment,[a,{...b,measurement:m}]).status,'not-verified')
  }
  p.write('app/src/runtime.ts','export const changed = true')
  assert.equal(aggregatePartials(p.root,suite,environment,[a,b]).status,'not-verified')
  fs.unlinkSync(path.join(a.run,'local-measurement.json')); fs.unlinkSync(path.join(b.run,'local-measurement.json'))
  assert.deepEqual(partialRuns(p.root).rows,[])
})

test('局部汇总：新失败/取消/强杀与篡改遮蔽旧成功，只修复失败目标且不清完整失败锁', t => {
  const p = fixture(t), time = Date.now()-1000
  const a = proof(p,'a','case',ids[0],time), b = proof(p,'b','scenario','merge-relaunch',time+10)
  const failure = proof(p,'failure','case',ids[0],time+20)
  const fail = { ...failure.result, status:'failed', failure:{required:['case/'+ids[0]]} }
  p.write(failure.relative+'/result.json',fail)
  let result = aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows); assert.deepEqual(result.missingCases,[ids[0]])
  fs.unlinkSync(path.join(failure.run,'result.json'))
  result = aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows); assert.deepEqual(result.missingCases,[ids[0]])
  p.write(failure.relative+'/result.json',{...fail,cancelled:true})
  proof(p,'repair','case',ids[0],time+30)
  result = aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows); assert.equal(result.status,'passed')
  assert.equal(aggregatePartials(p.root,suite,environment,[a,b],time+40).status,'not-verified','正式套件后续失败不能由之前局部成功覆盖')
})

test('专项粒度：本地与可信远端读相同差异，仍取基线/新策略并集且不执行 PR 源码', t => {
  const p = fixture(t,true)
  p.write('app/src/api/expenses.ts','import type { A } from "old"; export const value: A = 1')
  const base = p.commit()
  p.write('app/src/api/expenses.ts','import type { B } from "new"; export const value: B = 1')
  const head = p.commit(), plan = createPlan(p.root,'pull-request',{base})
  assert.deepEqual(plan.localRequired,[]); assert.deepEqual(requiredLocalSuites(p.root,base,head),[])
  p.write('app/src/api/expenses.ts','export const value = 2')
  const next = p.commit()
  assert.ok(requiredLocalSuites(p.root,base,next).some(s=>s.name==='ui-entry'))
  const r = registry(p.root), weakened = structuredClone(r)
  weakened.rules = []; delete weakened.unknownSource
  assert.ok(requiredLocalFromPolicies(r,weakened,['app/src/api/expenses.ts']).some(s=>s.name==='ui-entry'))
})

test('专项粒度：新套件摘要按执行依赖复用，旧无摘要证据不追认、不允许改定义', t => {
  const p = fixture(t,true); p.commit()
  const plan = createPlan(p.root,'simulator-boot')
  p.write('scripts/tests/new.test.mjs','// unrelated')
  assert.doesNotThrow(()=>assertMeasuredPlan(p.root,plan,'simulator-boot'))
  p.write('scripts/lib/ios-processes.mjs','// relevant')
  assert.throws(()=>assertMeasuredPlan(p.root,plan,'simulator-boot'),/失效/)
  const {id,measurementScopes,...body}=plan, legacy={...body,id:digest(body)}
  assert.throws(()=>assertMeasuredPlan(p.root,legacy,'simulator-boot'),/失效/)
})


test('局部汇总：统一自动门禁消费多份回执，缺项只列目标，旧正式失败仍阻断', t => {
  const p = fixture(t,true)
  p.write('app/src/views/me/dictionaries/ProductMergeView.vue','<template>before</template>')
  const base = p.commit()
  p.write('app/src/views/me/dictionaries/ProductMergeView.vue','<template>after</template>')
  p.commit()
  const time = Date.now()-1000
  proof(p,'a','case',ids[0],time)
  const options={readEnvironment:()=>environment}
  const partial = automaticLocalGate(p.root,base,options)
  const row = partial.result.suites.find(r=>r.suite==='ui-merge')
  assert.ok(row)
  assert.equal(row.status,'not-verified')
  assert.deepEqual(row.missingCases,[ids[1],ids[2]])
  proof(p,'b','scenario','merge-relaunch',time+10)
  const ready = automaticLocalGate(p.root,base,options)
  assert.equal(ready.result.suites.find(r=>r.suite==='ui-merge').status,'passed')
  const suite = ready.plan.localRequired.find(s=>s.name==='ui-merge')
  p.write('.local/ios/tmp/ai-agent/ios-ci-local-index/attempt-'+randomUUID()+'.json',{schema:1,entries:[{
    suite:suite.name,scopeInput:ready.plan.measurementScopes[suite.name],input:ready.plan.measurementInput,
    directory:'.local/ios/tmp/ai-agent/ios-ci-failed',status:'failed',startedAt:time+20,completedAt:time+21,order:'1'
  }]})
  assert.equal(automaticLocalGate(p.root,base,options).result.suites.find(r=>r.suite==='ui-merge').status,'not-verified')
})


test('局部汇总：假成功取消、未知失败目标、回读缺失及共享归属守卫不能放行', t => {
  const p = fixture(t), time = Date.now()-1000
  const a = proof(p,'a','case',ids[0],time), b = proof(p,'b','scenario','merge-relaunch',time+10)
  p.write(b.relative+'/result.json',{...b.result,cancelled:true})
  assert.equal(aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows).status,'not-verified')
  p.write(b.relative+'/result.json',b.result)
  fs.unlinkSync(path.join(b.run,'readback.log'))
  assert.equal(aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows).status,'not-verified')
  p.write(b.relative+'/readback.log',uiReadbackMarkers(selection('--scenario','merge-relaunch',[])).join('\n')+'\n')
  const f=proof(p,'bad','case',ids[0],time+20)
  p.write(f.relative+'/result.json',{...f.result,status:'failed',failure:{required:['case/unregistered']}})
  assert.deepEqual(aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows).missingCases,[ids[0]])
})

test('局部汇总：真实 verify CLI 已有部分证据时拒绝重跑整组，不调用原生执行器', t => {
  const p = fixture(t,true)
  fs.cpSync(path.join(repository,'scripts/lib'),path.join(p.root,'scripts/lib'),{recursive:true})
  // The child CLI must use the same locked parser as the parent issuing its fixture proof.
  // Without bootstrap it correctly fails closed, rather than recognising a different input projection.
  fs.mkdirSync(path.join(p.root,'app/node_modules'),{recursive:true})
  fs.symlinkSync(path.join(repository,'app/node_modules/typescript'),path.join(p.root,'app/node_modules/typescript'),'dir')
  p.write('.gitignore','.local/\napp/node_modules/\n')
  p.write('scripts/ios-local.mjs',fs.readFileSync(path.join(repository,'scripts/ios-local.mjs'),'utf8'))
  const metadata = fs.readFileSync(path.join(repository,'scripts/lib/ios-evidence-inputs.mjs'),'utf8')
  p.write('scripts/lib/ios-evidence-inputs.mjs',metadata.slice(0,metadata.indexOf('export function nativeEnvironment()'))+
    'export function nativeEnvironment() { return '+JSON.stringify(environment)+' }\n')
  p.write('scripts/ios-app.sh','#!/bin/sh\necho NATIVE_SHOULD_NOT_RUN >&2\nexit 89\n')
  p.write('app/src/views/me/dictionaries/ProductMergeView.vue','<template>before</template>')
  const base = p.commit();p.command('branch','-M','main')
  const remote = path.join(p.root,'.local/remote.git');p.command('init','--bare','-q',remote)
  p.command('remote','add','origin',remote);p.command('push','-q','origin','main')
  p.command('checkout','-qb','codex/test')
  p.write('app/src/views/me/dictionaries/ProductMergeView.vue','<template>after</template>');p.commit()
  p.write('.git/codex/local-gate.json',{schema:1,repository:'example/bill',remote:'origin',remoteUrl:remote,base:'main'})
  proof(p,'a','case',ids[0],Date.now()-1000)
  let stdout = '', stderr = ''
  try { execFileSync(process.execPath,['scripts/ios-local.mjs','verify'],{cwd:p.root,env:{...process.env,GITHUB_ACTIONS:'false'},encoding:'utf8',stdio:['ignore','pipe','pipe']});assert.fail('must refuse missing cases') }
  catch (error) { stdout = error.stdout?.toString() ?? ''; stderr = error.stderr?.toString() ?? '' }
  assert.match(stderr,/已有有效局部证据，不自动重复整组/)
  assert.match(stderr,/test09MergeConfirm/);assert.match(stderr,/test10RelaunchedMergeCandidates/)
  assert.doesNotMatch(stdout+stderr,/NATIVE_SHOULD_NOT_RUN/)
})


test('局部汇总：外层失败、取消、未完成及本人遗留命令锁拒绝，其他任务锁不误拦', t => {
  const p = fixture(t), time = Date.now()-1000
  proof(p,'a','case',ids[0],time);const b=proof(p,'b','scenario','merge-relaunch',time+10)
  const file=path.join(p.root,b.measurement.invocation), original=JSON.parse(fs.readFileSync(file))
  for (const change of [{status:'failed'},{cancelled:true},{status:'running'},{finishedAt:time}]) {
    p.write(b.measurement.invocation,{...original,...change})
    assert.equal(aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows).status,'not-verified')
  }
  p.write(b.measurement.invocation,original)
  p.write('.local/ios/tmp/ai-agent/ios-command.lock/owner.json',{pid:original.ownerPid})
  assert.equal(aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows).status,'not-verified')
  p.write('.local/ios/tmp/ai-agent/ios-command.lock/owner.json',{pid:original.ownerPid+1})
  assert.equal(aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows).status,'passed')
})

test('导出类型 AST：注释/换行/default/declare/重导出均保护，Vue 运行属性改变不能判等价', () => {
  const before='export /* public contract */ interface Props {item: string | number}'
  const after='export /* public contract */ interface Props {item: string}'
  assert.equal(runtimeEquivalent('props.ts',before,after),false)
  for (const prefix of ['export\n','export /* keep */ ','export\n/* keep */\ndefault '])
    assert.equal(runtimeEquivalent('props.ts',prefix+'interface Props {item:string}',prefix+'interface Props {item:number}'),false,prefix)
  for (const code of ['export /* keep */ type Props = string','export /* keep */ declare const props: string','export /* keep */ { type Props } from "./types"','export * from "./types"'])
    assert.equal(runtimeEquivalent('props.ts',code,code),false,code)
  assert.equal(runtimeEquivalent('private.ts','const value: string|number = "a"','const value: string = "a"'),true)
  const require=createRequire(new URL('../../app/package.json',import.meta.url)),{parse,compileScript}=require('@vue/compiler-sfc')
  const compiled=(types,name)=>{
    const {descriptor}=parse('<script setup lang="ts">import type {Props} from "./types";defineProps<Props>()</script>',{filename:'/ast-regression-'+name+'/View.vue'})
    return compileScript(descriptor,{id:name,fs:{fileExists:f=>f.endsWith('/types.ts'),readFile:()=>types}}).content
  }
  assert.match(compiled(before,'before'),/type: \[String, Number\]/)
  assert.match(compiled(after,'after'),/type: String,/)
})

const nativeId='NativeTests/NativeSqliteTests/testBundledEntryAndNativeSqliteBridge'
const nativeSuite={name:'native-sqlite',kind:'full',mode:'ios-smoke',runner:'macos'}
function nativeProof(p,name,time,{status='passed',required=['case/'+nativeId],register=true,coverage=[],input='a'.repeat(64),kind='case',target=nativeId}={}) {
  const selected=selection('--'+kind,target,[]),relative=p.base+'/run-'+name,run=path.join(p.root,relative)
  const invocation='.local/ios/tmp/ai-agent/ios-invocation-'+name+'/result.json'
  p.write(invocation,{scope:'invocation',mode:'debug run',status:status==='passed'?'passed':'failed',startedAt:time-1,finishedAt:time+2,ownerPid:999998})
  const m={...partialMeasurement(p.root,selected,JSON.stringify(environment),p.session),invocation,startedAt:time}
  if(register) registerPartial(p.root,run,m)
  p.write(relative+'/local-measurement.json',m)
  p.write(relative+'/test.log',selected.cases.map(id=>`Test Case '-[NativeTests.NativeSqliteTests ${id.split('/').at(-1)}]' passed (1 seconds).`).join('\n')+`\nExecuted ${selected.cases.length} test${selected.cases.length===1?'':'s'}, with 0 failures\n`)
  const result={scope:'partial',requested:{kind,name:target},executedCases:selected.cases,status,configuration:'Debug',
    inputHash:input,environment:m.environment,runId:m.runId,simulatorId:m.simulatorId,completedAt:time+1,
    coverage:[...selected.cases.map(id=>'case/'+id),...coverage],timings:coverage.map(key=>({status:'passed',coverage:[key]})),
    ...(status!=='passed'?{failure:{required}}:{})}
  if(status==='passed') result.measurementSeal=finishPartialMeasurement(p.root,run,selected,result)
  p.write(relative+'/result.json',result)
  if(register) recordLocal(p.root,run,result)
  return {run,relative,measurement:m,result}
}

test('统一失败拦截：原生新失败/取消/强杀阻断旧正式成功，定向修复恢复且不冒充完整集成', t => {
  const p=fixture(t),time=Date.now()-1000
  const failure=nativeProof(p,'failure',time,{status:'failed'})
  let assessed=partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root))
  assert.equal(assessed.failureTimes['case/'+nativeId],time+1)
  assert.ok(Object.values(assessed.failureTimes).some(t=>t>=time-10),'旧正式成功必须被阻断')
  p.write(failure.relative+'/result.json',{...failure.result,status:'failed',cancelled:true})
  assert.ok(Object.keys(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes).length)
  fs.unlinkSync(path.join(failure.run,'result.json'))
  assert.ok(Object.keys(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes).length)
  const repaired=nativeProof(p,'repair',time+10)
  assessed=partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root))
  assert.deepEqual(assessed.failureTimes,{})
  assert.ok(assessed.repairs.some(r=>r.target==='case/'+nativeId))
  assert.equal(aggregatePartials(p.root,nativeSuite,environment,partialRuns(p.root).rows),undefined,'单例不能替代完整 SQLite 套件')
  assert.ok(Object.values(readState(p.root).localFailures).length,'保留原失败记录')
  fs.appendFileSync(path.join(repaired.run,'test.log'),'tampered')
  assert.ok(Object.keys(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes).length)
})

test('统一失败拦截：阶段失败须真实重做、其他环境隔离，输入变化不丢失登记屏障', t => {
  const p=fixture(t),time=Date.now()-1000,key='native-install/App/Debug'
  makeHashable(p)
  nativeProof(p,'failure',time,{status:'failed',required:[key]})
  nativeProof(p,'cached',time+10)
  assert.equal(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes[key],time+1)
  nativeProof(p,'repair',time+20,{coverage:[key]})
  assert.deepEqual(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes,{})
  assert.deepEqual(partialFailureStatus(p.root,nativeSuite,{sdk:'other'},partialRuns(p.root)).failureTimes,{})
  p.write('app/src/runtime.ts','export const changed=true')
  assert.equal(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes[key],time+1,
    '不能重构的登记负结果仍保留屏障，失效的旧成功不能消除它')
  nativeProof(p,'currentRepair',time+30,{coverage:[key]})
  const current=partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root))
  assert.deepEqual(current.failureTimes,{})
  assert.ok(current.repairs.some(r=>r.target===key && r.reverifiedCurrentTarget===true),
    '当前阶段须实际重验，不声称旧输入等价或改写原失败')
})

test('损坏隔离：无关旧 JSON 不拦有效 UI，相关登记缺失/损坏及会话损坏仍锁定，修复后恢复', t => {
  const p=fixture(t),time=Date.now()-1000
  const a=proof(p,'a','case',ids[0],time),b=proof(p,'b','scenario','merge-relaunch',time+10)
  p.write(p.base+'/run-unrelated/local-measurement.json','{"broken":')
  let snapshot=partialRuns(p.root)
  assert.equal(snapshot.errors.length,1)
  assert.equal(aggregatePartials(p.root,suite,environment,snapshot.rows).status,'passed')
  const newer=proof(p,'bad','case',ids[0],time+20)
  registerPartial(p.root,newer.run,newer.measurement)
  p.write(newer.relative+'/local-measurement.json','{"broken":')
  snapshot=partialRuns(p.root)
  assert.ok(snapshot.rows.some(r=>r.run===newer.run && r.error))
  assert.ok(Object.keys(partialFailureStatus(p.root,suite,environment,snapshot).failureTimes).length)
  assert.equal(aggregatePartials(p.root,suite,environment,snapshot.rows).status,'not-verified')
  fs.unlinkSync(path.join(newer.run,'local-measurement.json'))
  assert.ok(Object.keys(partialFailureStatus(p.root,suite,environment,partialRuns(p.root)).failureTimes).length)
  const context=fs.readFileSync(path.join(p.session.directory,'test-context.json'))
  p.write(p.base+'/test-context.json','broken')
  assert.ok(Object.keys(partialFailureStatus(p.root,suite,environment,partialRuns(p.root)).failureTimes).length)
  fs.writeFileSync(path.join(p.session.directory,'test-context.json'),context)
  proof(p,'repair','case',ids[0],time+30)
  assert.equal(aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows).status,'passed')
})

test('损坏隔离：相关原生登记文件被截断或删除不丢失败，独立任务不误拦 UI', t => {
  const p=fixture(t),time=Date.now()-1000
  proof(p,'a','case',ids[0],time);proof(p,'b','scenario','merge-relaunch',time+10)
  const f=nativeProof(p,'failed',time+20,{status:'failed'})
  p.write(f.relative+'/local-measurement.json','half written')
  assert.ok(Object.keys(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes).length)
  assert.deepEqual(partialFailureStatus(p.root,suite,environment,partialRuns(p.root)).failureTimes,{})
  assert.equal(aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows).status,'passed')
  fs.unlinkSync(path.join(f.run,'local-measurement.json'))
  assert.ok(Object.keys(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes).length)
})

test('统一失败拦截：旧 localFailures 仍约束原生，未知损坏不冲掉历史，匹配新证明才恢复', t => {
  const p=fixture(t),time=Date.now()-1000
  makeHashable(p)
  const fingerprint=inputHash(p.root),failedRun=path.join(p.session.directory,'run-legacy')
  const state={schema:2,attempts:{},history:[{mode:'ios-touch',status:'failed'}],cacheRepairs:{},localFailures:{legacy:{
    run:failedRun,completedAt:time,inputHash:fingerprint,environment:JSON.stringify(environment),required:['case/'+nativeId],repairedAt:time+1
  }}}
  const statePath=p.write('.local/ios/tmp/ai-agent/ios-verification-state.json',state)
  const original=fs.readFileSync(statePath)
  assert.equal(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes['case/'+nativeId],time,'不盲信旧 repairedAt')
  assert.deepEqual(fs.readFileSync(statePath),original,'核验不改历史锁')
  const repair=nativeProof(p,'repair',time+10,{input:fingerprint})
  assert.deepEqual(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes,{})
  assert.ok(readState(p.root).localFailures.legacy,'原失败仍保留')
  p.write('.local/ios/tmp/ai-agent/ios-verification-state.json','broken global state')
  assert.throws(()=>partialRuns(p.root),'权威失败状态损坏仍拒绝，不当成空历史')
})

test('导出类型 AST：可信工作流先安装基线锁定依赖，普通回归自动发现且不启动设备',()=>{
  const workflow=fs.readFileSync(path.join(repository,'.github/workflows/local-evidence.yml'),'utf8')
  assert.match(workflow,/ref: \$\{\{ github.event.pull_request.base.sha \|\| github.sha \}\}/)
  const verifier=fs.readFileSync(path.join(repository,'scripts/ios-evidence.mjs'),'utf8')
  const pending=verifier.indexOf("if (publish) status('pending'")
  const setup=verifier.indexOf('if (publish) prepareTrustedParser(root)')
  assert.ok(pending>=0 && setup>pending && setup<verifier.indexOf('const required = requiredLocalSuites'))
  assert.match(verifier,/status\('failure'/)
  assert.doesNotMatch(workflow,/simctl|xcodebuild|pull_request\.head\.sha/)
})

test('统一失败拦截：篡改覆盖或阶段不能把缓存命中伪装成真实修复', t => {
  const p=fixture(t),time=Date.now()-1000,key='native-install/App/Debug'
  nativeProof(p,'failure',time,{status:'failed',required:[key]})
  const cached=nativeProof(p,'cached',time+10)
  p.write(cached.relative+'/result.json',{...cached.result,coverage:[...cached.result.coverage,key],timings:[{status:'passed',coverage:[key]}]})
  assert.ok(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes[key])
  nativeProof(p,'repair',time+20,{coverage:[key]})
  assert.deepEqual(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes,{})
})


test('导出类型 AST：基线解析依赖有界准备、拒绝私有源，安装脚本与发布令牌不传给子进程',t=>{
  const p=fixture(t,true),calls=[]
  const run=(...args)=>calls.push(args)
  prepareTrustedParser(p.root,{run,environment:{GH_TOKEN:'fixture-token',GITHUB_TOKEN:'fixture-token',PATH:'/fixture'}})
  assert.equal(calls.length,1)
  assert.deepEqual(calls[0].slice(0,2),['npm',['--prefix','app','ci','--ignore-scripts']])
  assert.equal(calls[0][2].timeout,60000)
  assert.equal(calls[0][2].env.GH_TOKEN,undefined);assert.equal(calls[0][2].env.GITHUB_TOKEN,undefined)
  assert.throws(()=>prepareTrustedParser(p.root,{run:()=>{throw new Error('bounded install failure')}}),/bounded install failure/)
  p.write('app/package-lock.json',{packages:{bad:{resolved:'https://private.invalid/package.tgz'}}})
  assert.throws(()=>prepareTrustedParser(p.root,{run}),/官方 HTTPS/)
  assert.equal(calls.length,1)
})


function makeHashable(p) {
  for(const dir of ['app/test-support','scripts/lib','scripts/tests']) fs.mkdirSync(path.join(p.root,dir),{recursive:true})
  const required=[...controlInputs,'app/package.json','app/package-lock.json','app/capacitor.config.ts','app/vite.config.ts','app/tsconfig.json','app/tsconfig.tools.json','scripts/normalize-capacitor-spm.mjs']
  for(const file of required) if(!fs.existsSync(path.join(p.root,file))) p.write(file,'')
}

test('分离默认类型导出：接口/别名/default/export= 保守保护，真实 Vue 属性改变不能判等价',()=>{
  const before='interface Props { item: string | number }; export default Props;'
  const after='interface Props { item: string }; export default Props;'
  assert.equal(runtimeEquivalent('types.ts',before,after),false)
  for(const tail of ['export /* alias */ default Props;','type Alias = Props; export default Alias;','export = Props;'])
    assert.equal(runtimeEquivalent('types.ts','interface Props {item:string}; '+tail,'interface Props {item:number}; '+tail),false,tail)
  assert.equal(runtimeEquivalent('types.ts','type Props = {item:string}; export default Props','type Props = {item:number}; export default Props'),false)
  const require=createRequire(new URL('../../app/package.json',import.meta.url)),{parse,compileScript}=require('@vue/compiler-sfc')
  const compiled=(types,id)=>{
    const {descriptor}=parse('<script setup lang="ts">import type Props from "./types";defineProps<Props>()</script>',{filename:'/default-export-'+id+'/View.vue'})
    return compileScript(descriptor,{id,fs:{fileExists:f=>f.endsWith('/types.ts'),readFile:()=>types}}).content
  }
  assert.match(compiled(before,'before'),/type: \[String, Number\]/)
  assert.match(compiled(after,'after'),/type: String,/)
  assert.equal(runtimeEquivalent('private.ts','const local: string|number="x"','const local: string="x"'),true)
})

test('空登记：无效旧测量不遮蔽 localFailures，损坏权威路由拒绝且不改失败历史',t=>{
  const p=fixture(t),time=Date.now()-1000
  makeHashable(p)
  const fingerprint=inputHash(p.root),f=nativeProof(p,'legacy',time,{status:'failed',register:false,input:fingerprint})
  const state={schema:2,attempts:{},history:[{mode:'ios-touch',status:'failed'}],cacheRepairs:{},localFailures:{old:{
    run:f.run,completedAt:time+1,inputHash:fingerprint,environment:JSON.stringify(environment),required:['case/'+nativeId]
  }}}
  const stateFile=p.write('.local/ios/tmp/ai-agent/ios-verification-state.json',state),original=fs.readFileSync(stateFile)
  for(const cases of [{},[],null,{bad:'a'.repeat(64)},{[nativeId]:'bad'}]) {
    p.write(f.relative+'/local-measurement.json',{...f.measurement,cases})
    const snapshot=partialRuns(p.root)
    assert.equal(snapshot.rows.length,0)
    assert.equal(partialFailureStatus(p.root,nativeSuite,environment,snapshot).failureTimes['case/'+nativeId],time+1)
    assert.deepEqual(fs.readFileSync(stateFile),original)
  }
  p.write(f.relative+'/local-measurement.json',{...f.measurement,host:'b'.repeat(64)})
  assert.equal(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes['case/'+nativeId],time+1,'同路径的其他宿主旧测量也不能遮蔽锁')
  for(const cases of [{},[],null,{[nativeId]:'bad'}]) {
    const corrupted={...state,localAttempts:{[f.relative]:{measurement:{...f.measurement,cases},status:'failed',completedAt:time+1,required:['case/'+nativeId]}}}
    p.write('.local/ios/tmp/ai-agent/ios-verification-state.json',corrupted)
    const bytes=fs.readFileSync(stateFile)
    assert.throws(()=>partialRuns(p.root),/登记结构无效/)
    assert.deepEqual(fs.readFileSync(stateFile),bytes)
  }
})

test('结果丢失定向补验：UI 两用例仅锁失败目标，缺失/截断/测量损坏沿用登记时间',t=>{
  const p=fixture(t),time=Date.now()-1000
  proof(p,'a','case',ids[0],time)
  proof(p,'old','scenario','merge-relaunch',time+10)
  const f=proof(p,'failed','scenario','merge-relaunch',time+20)
  registerPartial(p.root,f.run,f.measurement)
  const failed={...f.result,status:'failed',failure:{required:['case/'+ids[2]]}}
  p.write(f.relative+'/result.json',failed);recordLocal(p.root,f.run,failed)
  for(const mode of ['missing','truncated','measurement']) {
    p.write(f.relative+'/local-measurement.json',f.measurement)
    if(mode==='missing') fs.rmSync(path.join(f.run,'result.json'),{force:true})
    if(mode==='truncated') p.write(f.relative+'/result.json','{')
    if(mode==='measurement') {p.write(f.relative+'/result.json',failed);p.write(f.relative+'/local-measurement.json','{')}
    const snapshot=partialRuns(p.root),status=partialFailureStatus(p.root,suite,environment,snapshot)
    assert.deepEqual(status.failureTimes,{['case/'+ids[2]]:time+21})
    const aggregate=aggregatePartials(p.root,suite,environment,snapshot.rows)
    assert.deepEqual(aggregate.missingCases,[ids[2]])
    assert.ok(aggregate.proofs.some(proof=>proof.id===ids[1]),'未失败目标的有效旧证据保留')
  }
  proof(p,'repair','scenario','merge-relaunch',time+30)
  assert.equal(aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows).status,'passed')
})

test('结果丢失定向补验：原生组合只补登记的一个失败用例，旧锁保持并由匹配单例恢复',t=>{
  const p=fixture(t),time=Date.now()-1000,id='NativeTests/NativeSqliteTests/testIosTextScale'
  const f=nativeProof(p,'failed',time,{kind:'scenario',target:'ios-review',status:'failed',required:['case/'+id]})
  fs.unlinkSync(path.join(f.run,'result.json'))
  assert.deepEqual(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes,{['case/'+id]:time+1})
  nativeProof(p,'repair',time+10,{kind:'case',target:id})
  assert.deepEqual(partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root)).failureTimes,{})
  assert.ok(Object.values(readState(p.root).localFailures).some(lock=>lock.required.includes('case/'+id)))
})

test('统一依赖安装说明：可信基线 App 锁文件安装与禁止 PR 依赖/设备执行不矛盾',()=>{
  const guide=fs.readFileSync(path.join(repository,'agent-works/testing/guide.md'),'utf8')
  const workflow=fs.readFileSync(path.join(repository,'.github/workflows/local-evidence.yml'),'utf8')
  assert.doesNotMatch(guide,/不安装依赖或启动设备/)
  assert.match(guide,/仅安装可信基线 App 锁文件中的依赖/)
  assert.match(guide,/不安装 PR 依赖、不执行依赖安装脚本或启动设备/)
  assert.match(workflow,/trusted base App lockfile dependencies/)
})

test('回读协议：按真实场景及精确用例列表校验，拒绝缺失、跨场景、伪前缀及额外成功标记',()=>{
  const samples=[
    ['8','DICTIONARY_DEBUG_SQLITE_VERIFIED case=8'],
    ['entry-cycle','DICTIONARY_DEBUG_SQLITE_VERIFIED case=16\nENTRY_TOUCH_SQLITE_VERIFIED case=16\nENTRY_TOUCH_SQLITE_VERIFIED case=15'],
    ['personal-17,18','PERSONAL_TOUCH_SQLITE_VERIFIED cases=17,18'],
    ['lifecycle-26,27,28','LIFECYCLE_TOUCH_SQLITE_VERIFIED cases=26,27,28'],
    ['query-34,35','LEDGER_QUERY_TOUCH_SQLITE_VERIFIED cases=34,35'],
    ['report-42,41,38','REPORT_TOUCH_SQLITE_VERIFIED cases=42,41,38'],
    ['data-53,60,54','DATA_MANAGEMENT_SQLITE_FILES_VERIFIED cases=53,60,54'],
    ['interaction-61,62,63','IOS_INTERACTION_SQLITE_VERIFIED cases=61,62,63']
  ]
  for(const [fixture,signal] of samples) {
    const selected={fixture}
    assert.doesNotThrow(()=>assertUiReadback(selected,signal+'\n'))
    for(const invalid of ['', 'prefix '+signal, signal+'\nDICTIONARY_DEBUG_SQLITE_VERIFIED case=0', signal.replace(/\d/,'9')])
      assert.throws(()=>assertUiReadback(selected,invalid),/回读/)
  }
  assert.throws(()=>assertUiReadback({fixture:'personal-17,18'},'REPORT_TOUCH_SQLITE_VERIFIED cases=17,18'),/回读/)
  assert.throws(()=>assertUiReadback({fixture:'personal-17,18'},'PERSONAL_TOUCH_SQLITE_VERIFIED cases=18,17'),/回读/)
  assert.throws(()=>assertUiReadback({},'DICTIONARY_DEBUG_SQLITE_VERIFIED case=0'),/没有已登记/)
})

test('iOS 交互封存：真实触摸信号与独立 SQL 回读同时必需，摘要重算不掩盖缺项或错场景',t=>{
  const p=fixture(t),selected=selection('--scenario','ios-interaction',[])
  const signals=['IOS_KEYBOARD_NAVIGATION_VERIFIED','IOS_CANDIDATE_DATE_VERIFIED','IOS_LANDSCAPE_CANDIDATE_VERIFIED']
  const item=proof(p,'interaction','scenario','ios-interaction',Date.now()-1000)
  const suite={name:'ui-ios-interaction',kind:'ui',scenario:'ios-interaction',runner:'macos'}
  const log=fs.readFileSync(path.join(item.run,'test.log'),'utf8')
  const write=(text,readback=uiReadbackMarkers(selected).join('\n')+'\n')=>{
    p.write(item.relative+'/test.log',text);p.write(item.relative+'/readback.log',readback)
    item.result.measurementSeal=partialSeal(item.run,item.measurement,item.result)
    p.write(item.relative+'/result.json',item.result)
  }
  const verify=()=>aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows)
  for(const invalid of [[],signals.slice(0,2),[...signals].reverse(),[...signals,signals[0]]]) {
    write(log+invalid.join('\n')+'\n');assert.equal(verify().status,'not-verified')
    assert.throws(()=>assertUiInteractionLog(selected,invalid.join('\n')),/触摸/)
  }
  write(log+signals.join('\n')+'\n');assert.equal(verify().status,'passed')
  write(log+signals.join('\n')+'\n','DICTIONARY_DEBUG_SQLITE_VERIFIED case=0\n')
  assert.equal(verify().status,'not-verified','触摸成功也不能替代 SQL 草稿回读')
  write(log+signals.join('\n')+'\n');assert.equal(verify().status,'passed')
  const raw=fs.readFileSync(path.join(item.run,'result.json'))
  p.write(item.relative+'/local-measurement.json',{...item.measurement,baseline:'c'.repeat(64)})
  assert.equal(verify().status,'not-verified','原安装基线不能被新摘要替代')
  assert.deepEqual(fs.readFileSync(path.join(item.run,'result.json')),raw)
})

function compatibleFixture(t) {
  const p=fixture(t)
  for(const file of ['config/ios-measurement-v1.json','scripts/lib/ios-local-measurement.mjs','scripts/lib/ios-execution-inputs.mjs',
    'scripts/lib/ios-ci-run.mjs','scripts/lib/ios-verification.mjs','scripts/lib/ios-local-partials.mjs','scripts/lib/ios-capacity-registration.mjs','scripts/lib/ios-measurement-scope.mjs','scripts/lib/ios-ui-readback.mjs','scripts/lib/ios-scenario-dependencies.mjs'])
    p.write(file,fs.readFileSync(path.join(repository,file),'utf8'))
  return p
}

test('场景依赖：专属交互模块不作废其他测量，未知共享变化仍失效且不作废构建层',t=>{
  const p=compatibleFixture(t),boot={kind:'environment'},native={kind:'full',mode:'ios-smoke'}
  for(const file of ['scripts/lib/ios-debug.mjs','scripts/fixtures/dictionary-touch.py','scripts/fixtures/ios_interaction.py'])
    p.write(file,fs.readFileSync(path.join(repository,file),'utf8'))
  const selected=selection('--scenario','ios-interaction',[])
  const interaction=selected.cases[0]
  const scopes=()=>[suiteMeasurement(p.root,boot),suiteMeasurement(p.root,native),caseMeasurement(p.root,ids[0]),caseMeasurement(p.root,interaction)]
  const builds=()=>layerInputs(p.root,'fixed-toolchain',selected,{assets:'assets',probe:'probe'})
  const original=scopes(),helper=path.join(p.root,'scripts/fixtures/ios_interaction.py'),raw=fs.readFileSync(helper)
  fs.appendFileSync(helper,'\n# interaction-only execution change\n')
  const changed=scopes()
  assert.deepEqual(changed.slice(0,3),original.slice(0,3))
  assert.notEqual(changed[3],original[3]);fs.writeFileSync(helper,raw)
  for(const file of ['scripts/lib/ios-debug.mjs','scripts/fixtures/dictionary-touch.py','scripts/fixtures/ios_interaction.py']) {
    const current=fs.readFileSync(path.join(p.root,file))
    const before=scopes(),layers=builds()
    p.write(file,'// changed execution source '+file)
    const after=scopes()
    if(!file.endsWith('ios_interaction.py')) {
      assert.notEqual(after[1],before[1],'未知共享执行布局保守失效')
      assert.notEqual(after[2],before[2],'未知共享布局不能忽略依赖')
    } else assert.deepEqual(after.slice(0,3),before.slice(0,3))
    assert.notEqual(after[3],before[3])
    if(file.endsWith('ios-debug.mjs'))assert.notEqual(after[0],before[0],'启动同样绑定共享选择器')
    else assert.equal(after[0],before[0],'夹具不属于受管启动执行输入')
    assert.deepEqual(builds(),layers,'执行证据失效不等于重新编译制品')
    fs.writeFileSync(path.join(p.root,file),current)
  }
})

test('执行与消费边界：旧编码只在固定生产者匹配时复用，消费改动不失效，执行/资源/夹具变化仍失效',t=>{
  const p=compatibleFixture(t),native={kind:'full',mode:'ios-smoke'}
  const before=caseMeasurement(p.root,ids[0]),nativeBefore=suiteMeasurement(p.root,native)
  for(const file of ['scripts/lib/ios-local-partials.mjs','scripts/lib/ios-measurement-scope.mjs','scripts/lib/ios-ui-readback.mjs']) {
    fs.appendFileSync(path.join(p.root,file),'\n// consumer-only change\n')
    assert.equal(caseMeasurement(p.root,ids[0]),before,file)
    assert.equal(suiteMeasurement(p.root,native),nativeBefore,file)
  }
  const ci=path.join(p.root,'scripts/lib/ios-ci-run.mjs'),originalCi=fs.readFileSync(ci,'utf8')
  fs.appendFileSync(ci,'\n// validation-only change\n')
  assert.equal(suiteMeasurement(p.root,native),nativeBefore)
  fs.writeFileSync(ci,originalCi.replace('export async function executeGroup','// changed command issuer\nexport async function executeGroup'))
  assert.notEqual(suiteMeasurement(p.root,native),nativeBefore)
  assert.equal(caseMeasurement(p.root,ids[0]),before,'直接 UI 调试不绑定 CI 组命令')
  fs.writeFileSync(ci,originalCi)
  for(const file of ['scripts/lib/ios-local-measurement.mjs','scripts/lib/ios-execution-inputs.mjs','app/src/baseline.ts','app/test-support/scenario.ts','scripts/fixtures/owned.py']) {
    const full=path.join(p.root,file),original=fs.existsSync(full)?fs.readFileSync(full):undefined
    p.write(file,(original??'')+'\n// execution input changed\n')
    assert.notEqual(caseMeasurement(p.root,ids[0]),before,file)
    if(original)fs.writeFileSync(full,original);else fs.unlinkSync(full)
  }
  const policy=JSON.parse(fs.readFileSync(path.join(p.root,'config/ios-measurement-v1.json')))
  policy.sources['scripts/lib/ios-local-partials.mjs'].content+='tampered'
  p.write('config/ios-measurement-v1.json',JSON.stringify(policy))
  assert.throws(()=>caseMeasurement(p.root,ids[0]),/编码材料损坏/)
})

test('受控 v1 提取：登记、封存及 Swift 用例依赖函数保持原实现，兼容材料只作为数据',()=>{
  const require=createRequire(new URL('../../app/package.json',import.meta.url)),ts=require('typescript')
  const policy=JSON.parse(fs.readFileSync(path.join(repository,'config/ios-measurement-v1.json')))
  const declarations=text=>{
    const parsed=ts.createSourceFile('source.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),out=new Map()
    for(const node of parsed.statements) {
      if(ts.isFunctionDeclaration(node))out.set(node.name.text,node.getText(parsed).replace(/^export /,''))
      if(ts.isVariableStatement(node))for(const item of node.declarationList.declarations)out.set(item.name.getText(parsed),item.getText(parsed))
    }
    return out
  }
  for(const [oldFile,newFile,names] of [
    ['scripts/lib/ios-local-partials.mjs','scripts/lib/ios-local-measurement.mjs',['hash','read','assertMeasurement','partialMeasurement','registerPartial','partialSeal','finishPartialMeasurement']],
    ['scripts/lib/ios-measurement-scope.mjs','scripts/lib/ios-execution-inputs.mjs',['maskSwift','swiftCaseInput','caseMeasurement','caseMeasurements','suiteMeasurement','uiExecutionInput','common']]
  ]) {
    const source=fs.readFileSync(path.join(repository,newFile),'utf8')
    const old=declarations(policy.sources[oldFile].content),current=declarations(legacyProducerSource(newFile,source))
    for(const name of names)assert.equal(current.get(name),old.get(name),name)
  }
})

test('UI 准备失败在基线之前：真实阶段重做可恢复，缓存/其他会话及无基线的业务失败仍拒绝',t=>{
  const p=fixture(t),time=Date.now()-1000,key='native-build/DictionaryTouch/Release'
  makeHashable(p)
  const f=proof(p,'failed','case',ids[0],time),m={...f.measurement};delete m.baseline
  p.write(f.relative+'/local-measurement.json',m);registerPartial(p.root,f.run,m)
  const failed={...f.result,status:'failed',failure:{required:[key]}}
  p.write(f.relative+'/result.json',failed);recordLocal(p.root,f.run,failed)
  proof(p,'cached','case',ids[0],time+10)
  assert.equal(partialFailureStatus(p.root,suite,environment,partialRuns(p.root)).failureTimes[key],time+1)
  const context={...p.session.context,runId:randomUUID(),simulatorId:randomUUID()}
  context.name='我的账单调试-'+context.runId
  const base='.local/ios/tmp/ai-agent/ios-debug-other'
  p.write(base+'/test-context.json',context)
  const other=proof({...p,base,session:{directory:path.join(p.root,base),context}},'otherrepair','case',ids[0],time+15)
  other.result.coverage.push(key);other.result.timings.push({status:'passed',coverage:[key]})
  other.result.measurementSeal=partialSeal(other.run,other.measurement,other.result)
  p.write(other.relative+'/result.json',other.result)
  assert.equal(partialFailureStatus(p.root,suite,environment,partialRuns(p.root)).failureTimes[key],time+1)
  const repair=proof(p,'repair','case',ids[0],time+20)
  repair.result.coverage.push(key);repair.result.timings.push({status:'passed',coverage:[key]})
  repair.result.measurementSeal=partialSeal(repair.run,repair.measurement,repair.result)
  p.write(repair.relative+'/result.json',repair.result)
  assert.deepEqual(partialFailureStatus(p.root,suite,environment,partialRuns(p.root)).failureTimes,{})
  p.write(f.relative+'/result.json',{...failed,failure:{required:['case/'+ids[0]]}})
  recordLocal(p.root,f.run,{...failed,failure:{required:['case/'+ids[0]]}})
  assert.ok(partialFailureStatus(p.root,suite,environment,partialRuns(p.root)).failureTimes['case/'+ids[0]],'没有旧业务基线不能靠新基线修复')
})

test('兼容白名单不能只改登记数据重设生产者摘要，原始编码损坏及符号链接拒绝',t=>{
  const p=compatibleFixture(t),file='config/ios-measurement-v1.json',raw=fs.readFileSync(path.join(p.root,file),'utf8')
  const policy=JSON.parse(raw)
  policy.producerPins['scripts/lib/ios-local-measurement.mjs']='0'.repeat(64)
  p.write(file,JSON.stringify(policy))
  assert.throws(()=>caseMeasurement(p.root,ids[0]),/不能重设兼容白名单/)
  p.write(file,raw)
  const producer=path.join(p.root,'scripts/lib/ios-local-measurement.mjs'),copy=path.join(p.root,'.local/issuer.mjs')
  fs.mkdirSync(path.dirname(copy),{recursive:true});fs.renameSync(producer,copy);fs.symlinkSync(copy,producer)
  assert.throws(()=>caseMeasurement(p.root,ids[0]),/普通文件/)
})

test('CI 消费改动不误触发启动专项，命令变化或未知边界仍选择专项',()=>{
  const before=fs.readFileSync(path.join(repository,'scripts/lib/ios-ci-run.mjs'),'utf8')
  const suite={kind:'environment'},file='scripts/lib/ios-ci-run.mjs'
  const changed=after=>relevantChange(suite,file,new Map([[file,{before,after}]]))
  assert.equal(changed(before+'\n// consumer only\n'),false)
  assert.equal(changed(before.replace("throw new Error('UI 实际用例不符。')","throw new Error('different consumer error')")),false)
  assert.equal(changed(before.replace("['scripts/ios-app.sh', 'debug', 'create'","['scripts/ios-app.sh', 'debug', 'changed'")),true)
  assert.equal(changed(before.replace('// CI_CONSUMER_BOUNDARY:','// moved boundary:')),true)
  assert.equal(changed(before+'\n// CI_CONSUMER_BOUNDARY: unexpected second boundary'),true)
  assert.equal(changed(before.replace('  if (error) throw error','  lateCommand(); if (error) throw error')+'\nfunction lateCommand() {}'),true)
  const r=registry(repository)
  const consumer=selectSuites(r,'change',[file],{execution:'local',changes:new Map([[file,{before,after:before+'\n// consumer only\n'}]])}).map(s=>s.name)
  assert.deepEqual(consumer,['secrets','scripts','scripts-macos','workflow-quality'])
  assert.deepEqual(selectSuites(r,'change',['config/ios-measurement-v1.json'],{execution:'local'}).map(s=>s.name),consumer)
})

test('CI 与局部共用回读和原封存校验：字典及 iOS 交互归档拒绝跨场景回读和损坏基线',async t=>{
  const descriptor=Object.getOwnPropertyDescriptor(process,'platform')
  Object.defineProperty(process,'platform',{value:'darwin'})
  try {
    for(const [scene,suiteName] of [['merge-cycle','ui-merge'],['ios-interaction','ui-ios-interaction']]) {
      const p=fixture(t,true);makeHashable(p)
      p.session.context.state='open';p.write(p.base+'/test-context.json',p.session.context)
      p.commit()
      const original=proof(p,'archive','scenario',scene,Date.now()-1000)
      if(scene==='ios-interaction')fs.appendFileSync(path.join(original.run,'test.log'),
        'IOS_KEYBOARD_NAVIGATION_VERIFIED\nIOS_CANDIDATE_DATE_VERIFIED\nIOS_LANDSCAPE_CANDIDATE_VERIFIED\n')
      original.result.inputHash=inputHash(p.root)
      original.result.measurementSeal=partialSeal(original.run,original.measurement,original.result)
      p.write(original.relative+'/result.json',original.result)
      const plan=createPlan(p.root,suiteName),directory=resultsDirectory(p.root,'.local/ios/tmp/ai-agent/ios-ci-archive',true)
      p.write(path.relative(p.root,path.join(directory,'ci-plan.json')),plan)
      await executeGroup(p.root,directory,'macos',{session:p.session.directory,command:async(_root,_program,args)=>{
        if(args[1]==='debug'&&args[2]==='run')return 'EVIDENCE='+original.run+'\n'
        if(args[1]==='debug'&&args[2]==='suspend')return ''
        throw new Error('unexpected native command')
      }})
      const suite=plan.suites[0],check=()=>validateSuiteEvidence(p.root,directory,plan,suite)
      assert.doesNotThrow(check)
      const receiptFile=path.join(directory,suite.name,'receipt.json'),receiptRaw=fs.readFileSync(receiptFile)
      const receipt=JSON.parse(receiptRaw),report=receipt.reports.find(r=>r.role==='primary'&&r.origin.endsWith('/readback.log'))
      const archived=path.join(directory,suite.name,report.path),raw=fs.readFileSync(archived)
      fs.writeFileSync(archived,'PERSONAL_TOUCH_SQLITE_VERIFIED cases=17,18\n');report.hash=digest(fs.readFileSync(archived))
      fs.writeFileSync(receiptFile,JSON.stringify(receipt))
      assert.throws(check,/回读|归档/,'重算普通摘要也不能把其他场景的回读当成通过')
      fs.writeFileSync(archived,raw);fs.writeFileSync(receiptFile,receiptRaw)
      const manifest=path.join(original.run,'local-measurement.json'),bytes=fs.readFileSync(manifest)
      p.write(original.relative+'/local-measurement.json',{...original.measurement,baseline:'c'.repeat(64)})
      assert.throws(check,/摘要|基线|归档/,'归档成功不能替代原始基线/封存校验')
      fs.writeFileSync(manifest,bytes);assert.doesNotThrow(check)
    }
  } finally {Object.defineProperty(process,'platform',descriptor)}
})

test('完整入口的修复证明复用原封存：消费者变化可重读，普通未封存检查/错误环境/真实执行变化拒绝',t=>{
  const p=compatibleFixture(t);makeHashable(p)
  const item=proof(p,'reuse','case',ids[0],Date.now()-1000)
  const bytes=fs.readFileSync(path.join(item.run,'result.json'))
  // Global engineering fingerprint can change while this sealed UI execution remains identical.
  p.write('scripts/tests/consumer-new.test.mjs','// changed consumer regression')
  const current=inputHash(p.root)
  assert.notEqual(item.result.inputHash,current)
  assert.doesNotThrow(()=>requireEvidence(p.root,item.run,current,JSON.stringify(environment)))
  const unsealed=p.write('.local/ios/tmp/ai-agent/ios-check-unsealed/result.json',{
    scope:'partial',status:'passed',inputHash:'a'.repeat(64),check:'resources',options:{target:'source'},
    completedAt:Date.now(),coverage:['check/resources/source'],command:{exit:0,program:path.basename(process.execPath),args:['scripts/verify-ios-resources.mjs']}
  })
  assert.throws(()=>requireEvidence(p.root,path.dirname(unsealed),current),/版本不符/)
  assert.deepEqual(fs.readFileSync(path.join(item.run,'result.json')),bytes)
  assert.throws(()=>requireEvidence(p.root,item.run,current,JSON.stringify({sdk:'other'})),/环境/)
  assert.throws(()=>requireEvidence(p.root,item.run,'b'.repeat(64),JSON.stringify(environment)),/版本/,'任意旧指纹不能请求复用')
  p.write('app/src/baseline.ts','export const changed=true')
  assert.throws(()=>requireEvidence(p.root,item.run,inputHash(p.root),JSON.stringify(environment)),/版本/)
})

test('验证入口 AST 消费边界：只忽略已知读取函数及专用导入，登记/次数/顶层副作用与未知语法仍失效',t=>{
  const p=compatibleFixture(t),file='scripts/lib/ios-verification.mjs',full=path.join(p.root,file)
  const before=fs.readFileSync(full,'utf8'),initial=caseMeasurement(p.root,ids[0])
  fs.writeFileSync(full,before.replace('局部证据失败、过期、版本不符或环境不符（无有效原始封存证据）。','changed consumer message'))
  assert.equal(caseMeasurement(p.root,ids[0]),initial)
  for(const source of [before.replace('export function beginFull(','export function changedBeginFull('),
    before.replace('state.localFailures[key] = {','state.localFailures[key] = {changed: true,'),
    before+'\nglobalThis.unexpected = true\n',before+'\ninvalid ::::']) {
    fs.writeFileSync(full,source)
    assert.notEqual(caseMeasurement(p.root,ids[0]),initial)
  }
})

test('严格兼容：原摘要不刷新，独立交互扩展前后其他场景逐字节一致，未知分支或额外导入保守失效',t=>{
  const p=compatibleFixture(t)
  const files=['scripts/lib/ios-debug.mjs','scripts/fixtures/dictionary-touch.py']
  const current=Object.fromEntries(files.map(file=>[file,fs.readFileSync(path.join(repository,file))]))
  for(const file of files)p.write(file,scopedSource(file,current[file],false).toString())
  const before=[suiteMeasurement(p.root,{kind:'environment'}),suiteMeasurement(p.root,{kind:'full',mode:'ios-smoke'}),caseMeasurement(p.root,ids[0])]
  const policy=fs.readFileSync(path.join(p.root,'config/ios-measurement-v1.json'))
  const binary=Buffer.from([0xff,0x00,0x80,0xfe])
  assert.deepEqual(scopedSource('app/public/icon.png',binary,false),binary)
  for(const file of files)p.write(file,current[file].toString())
  const module='scripts/fixtures/ios_interaction.py';p.write(module,fs.readFileSync(path.join(repository,module),'utf8'))
  const measure=()=>[suiteMeasurement(p.root,{kind:'environment'}),suiteMeasurement(p.root,{kind:'full',mode:'ios-smoke'}),caseMeasurement(p.root,ids[0])]
  assert.deepEqual(measure(),before)
  assert.deepEqual(fs.readFileSync(path.join(p.root,'config/ios-measurement-v1.json')),policy)
  const companion='scripts/fixtures/companion.py',moduleRaw=fs.readFileSync(path.join(p.root,module))
  for(const [file,source] of [[companion,'from ios_interaction import run'],
    [companion,'import importlib; importlib.import_module("ios_"+"interaction")'],
    ['scripts/fixtures/nested/ios_interaction.py','from ios_interaction import run']]) {
    p.write(file,source)
    const shared=measure()[2]
    fs.appendFileSync(path.join(p.root,module),'\n# shared through companion\n')
    assert.notEqual(measure()[2],shared,'伴随模块直接/动态导入时必须绑定 helper')
    fs.writeFileSync(path.join(p.root,module),moduleRaw)
    fs.unlinkSync(path.join(p.root,file))
  }
  fs.rmdirSync(path.join(p.root,'scripts/fixtures/nested'))
  const py='scripts/fixtures/dictionary-touch.py'
  p.write(py,current[py].toString()+'\nfrom ios_interaction import run as unexpected_import\n')
  assert.notEqual(measure()[2],before[2],'独占导入条件不成立时不得忽略专属模块')
  p.write(py,current[py].toString())
  p.write(files[0],current[files[0]].toString().replace('indices.every(index => index >= 61)','indices.every(index => index >= 60)'))
  assert.notEqual(measure()[2],before[2],'未知选择条件不投影')
  p.write(files[0],current[files[0]].toString())
  p.write('scripts/lib/ios-scenario-dependencies.mjs','// changed scope policy')
  assert.notEqual(measure()[2],before[2],'依赖投影规则本身改变时不能继续旧编码兼容')
})

test('同输入 --from、汇总与签发统一封存/双信号，缺信号/回读/基线/归属及未收尾均拒绝且不动原失败锁',t=>{
  const p=fixture(t),selected=selection('--scenario','ios-interaction',[])
  makeHashable(p)
  const item=proof(p,'strictsame','scenario','ios-interaction',Date.now()-1000)
  const signals='IOS_KEYBOARD_NAVIGATION_VERIFIED\nIOS_CANDIDATE_DATE_VERIFIED\nIOS_LANDSCAPE_CANDIDATE_VERIFIED\n'
  const log=fs.readFileSync(path.join(item.run,'test.log'),'utf8'),readback=fs.readFileSync(path.join(item.run,'readback.log'))
  item.result.inputHash=inputHash(p.root)
  const originalState=p.write('.local/ios/tmp/ai-agent/ios-verification-state.json',{
    schema:2,attempts:{},history:[{mode:'ios-touch',status:'failed'}],localFailures:{},cacheRepairs:{}})
  const state=fs.readFileSync(originalState),invocation=path.join(p.root,item.measurement.invocation),terminal=fs.readFileSync(invocation)
  const reset=()=>{
    p.write(item.relative+'/test.log',log+signals);fs.writeFileSync(path.join(item.run,'readback.log'),readback)
    p.write(item.relative+'/fixture.json',{source:'owned-synthetic'})
    p.write(item.relative+'/local-measurement.json',item.measurement);fs.writeFileSync(invocation,terminal)
    item.result.measurementSeal=partialSeal(item.run,item.measurement,item.result)
    p.write(item.relative+'/result.json',item.result)
  }
  const suite={name:'ui-ios-interaction',kind:'ui',scenario:'ios-interaction',runner:'macos'}
  const consume=()=>requireEvidence(p.root,item.run,item.result.inputHash,JSON.stringify(environment))
  reset();assert.doesNotThrow(consume);assert.doesNotThrow(()=>finishPartialMeasurement(p.root,item.run,selected,item.result))
  for(const kind of ['signal','readback','baseline','fixture','terminal']) {
    reset()
    if(kind==='signal')p.write(item.relative+'/test.log',log)
    if(kind==='readback')p.write(item.relative+'/readback.log','DICTIONARY_DEBUG_SQLITE_VERIFIED case=0\n')
    if(['signal','readback'].includes(kind)) {
      item.result.measurementSeal=partialSeal(item.run,item.measurement,item.result)
      p.write(item.relative+'/result.json',item.result)
      assert.throws(()=>finishPartialMeasurement(p.root,item.run,selected,item.result),/触摸|回读/,'不能登记为成功')
    }
    if(kind==='baseline')p.write(item.relative+'/local-measurement.json',{...item.measurement,baseline:'c'.repeat(64)})
    if(kind==='fixture')fs.unlinkSync(path.join(item.run,'fixture.json'))
    if(kind==='terminal')p.write(item.measurement.invocation,{...JSON.parse(terminal),status:'failed'})
    assert.throws(consume,/封存/,kind)
    assert.throws(()=>validateLocalPartial(p.root,item.run),undefined,kind)
    assert.equal(aggregatePartials(p.root,suite,environment,partialRuns(p.root).rows).status,'not-verified',kind)
    assert.deepEqual(fs.readFileSync(originalState),state)
  }
  reset();assert.doesNotThrow(consume)
})

function equivalentFixture(t, git=false) {
  const p=git?fixture(t,true):compatibleFixture(t)
  if(git)for(const file of ['config/ios-measurement-v1.json','scripts/lib/ios-local-measurement.mjs','scripts/lib/ios-execution-inputs.mjs','scripts/lib/ios-ci-run.mjs','scripts/lib/ios-verification.mjs','scripts/lib/ios-scenario-dependencies.mjs','scripts/lib/ios-local-partials.mjs','scripts/lib/ios-capacity-registration.mjs'])
    p.write(file,fs.readFileSync(path.join(repository,file),'utf8'))
  for(const file of ['scripts/lib/ios-debug.mjs','scripts/fixtures/dictionary-touch.py','scripts/fixtures/ios_interaction.py'])
    p.write(file,fs.readFileSync(path.join(repository,file),'utf8'))
  makeHashable(p)
  return p
}

test('等价执行跨摘要：中间粗粒度的新失败/取消/未完成/结果丢失阻断旧成功，定向修复仍须原基线和归属',t=>{
  for(const status of ['failed','cancelled','unfinished','missing']) {
    const p=equivalentFixture(t),time=Date.now()-2000
    const old=proof(p,'before','scenario','merge-cycle',time)
    const aliases=equivalentCaseInputs(p.root,ids)
    assert.equal(aliases[ids[0]].length,2,'必须真实覆盖两种不同摘要')
    const latest=proof(p,'newer','case',ids[0],time+20)
    latest.measurement.cases[ids[0]]=aliases[ids[0]][1]
    p.write(latest.relative+'/local-measurement.json',latest.measurement)
    registerPartial(p.root,latest.run,latest.measurement)
    const failed={...latest.result,status:'failed',cancelled:status==='cancelled',failure:{required:['case/'+ids[0]]}}
    if(status==='unfinished')fs.unlinkSync(path.join(latest.run,'result.json'))
    else {p.write(latest.relative+'/result.json',failed);recordLocal(p.root,latest.run,failed)}
    if(status==='missing')fs.unlinkSync(path.join(latest.run,'result.json'))
    const state=fs.readFileSync(path.join(p.root,'.local/ios/tmp/ai-agent/ios-verification-state.json'))
    const inspect=()=>{const snapshot=partialRuns(p.root);return{snapshot,partial:aggregatePartials(p.root,suite,environment,snapshot.rows),failure:partialFailureStatus(p.root,suite,environment,snapshot)}}
    const blocked=inspect()
    assert.deepEqual(blocked.partial.missingCases,[ids[0]],status)
    assert.equal(blocked.failure.failureTimes['case/'+ids[0]],status==='unfinished'?time+20:time+21,status)
    proof(p,'wrongbaseline','case',ids[0],time+30,{baseline:'c'.repeat(64)})
    assert.ok(inspect().failure.failureTimes['case/'+ids[0]],'不同基线不能修复跨摘要失败')
    const fixed=proof(p,'fixed','case',ids[0],time+40)
    assert.equal(inspect().partial.status,'passed',status)
    assert.equal(inspect().failure.failureTimes['case/'+ids[0]],undefined,status)
    assert.equal(inspect().failure.repairs.find(r=>r.target==='case/'+ids[0]).run,fixed.run)
    assert.deepEqual(fs.readFileSync(path.join(p.root,'.local/ios/tmp/ai-agent/ios-verification-state.json')),state)
    assert.equal(JSON.parse(fs.readFileSync(path.join(old.run,'result.json'))).status,'passed')
  }
})

test('正式索引跨摘要：失败/取消/未完成的粗粒度尝试仍形成时间屏障，不回退较早局部绿色',t=>{
  for(const status of ['failed','cancelled','running']) {
    const p=equivalentFixture(t,true)
    p.write('app/src/views/me/dictionaries/ProductMergeView.vue','<template>before</template>');const base=p.commit()
    p.write('app/src/views/me/dictionaries/ProductMergeView.vue','<template>after</template>')
    const time=Date.now()-2000
    proof(p,'before','scenario','merge-cycle',time)
    const plan=createPlan(p.root,'pull-request',{base}),aliases=equivalentSuiteInputs(p.root,suite)
    assert.equal(aliases.length,2)
    p.write('.local/ios/tmp/ai-agent/ios-ci-local-index/attempt-'+randomUUID()+'.json',{schema:1,entries:[{
      suite:'ui-merge',input:plan.measurementInput,scopeInput:aliases[1],directory:'.local/ios/tmp/ai-agent/ios-ci-unfinished',
      status,startedAt:time+10,completedAt:time+20,order:'1'}]})
    const gate=()=>automaticLocalGate(p.root,base,{readEnvironment:()=>environment}).result.suites.find(row=>row.suite==='ui-merge')
    assert.equal(gate().status,'not-verified',status)
    proof(p,'after','scenario','merge-cycle',time+30)
    assert.equal(gate().status,'passed',status)
  }
})

function capacityProof(p) {
  const relative=p.base+'/run-capacity',run=path.join(p.root,relative)
  fs.mkdirSync(run)
  const value=scaleProtocolFixture(p.root,JSON.stringify(environment),path.join(run,'cold.log'),p.session.context.simulatorId)
  const invocation={run:path.join(p.root,'.local/ios/tmp/ai-agent/ios-invocation-capacity'),ownerPid:999997}
  p.write(path.relative(p.root,invocation.run)+'/result.json',{
    scope:'invocation',mode:'debug run',status:'running',startedAt:900,ownerPid:invocation.ownerPid})
  const measured={...partialMeasurement(p.root,value.selected,JSON.stringify(environment),p.session,invocation),startedAt:950}
  registerPartial(p.root,run,measured)
  p.write(relative+'/local-measurement.json',measured)
  p.write(path.relative(p.root,invocation.run)+'/result.json',{
    scope:'invocation',mode:'debug run',status:'passed',startedAt:900,finishedAt:3400,ownerPid:invocation.ownerPid})
  for(const [name,raw]of Object.entries(value.logs))p.write(relative+'/'+name,raw)
  const context=Object.fromEntries(['runId','mode','deviceId','count','sourceHash','artifactHash'].map(key=>[key,value.receipt[key]]))
  p.write(relative+'/capacity-context.json',context)
  p.write(p.base+'/capacity-owner.json',{kind:'capacity',owner:p.session.context.runId,deviceId:context.deviceId,
    appId:value.receipt.appId,artifactHash:context.artifactHash})
  const result={...value.result,runId:p.session.context.runId,configuration:'Release',inputHash:inputHash(p.root),capacityReport:path.join(run,'capacity-report.json')}
  p.write(relative+'/result.json',result)
  return {run,relative,result,context,value,measured,invocation}
}

test('Capacity 入口按独立执行前登记及原始完整报告验收，不接受仅改请求/通过日志或损坏阶段',t=>{
  const p=fixture(t);makeHashable(p);const item=capacityProof(p)
  const check=()=>requireEvidence(p.root,item.run,inputHash(p.root),JSON.stringify(environment))
  assert.doesNotThrow(check)
  const cases=item.value.selected.cases.map(id=>'case/'+id)
  assert.deepEqual(check().result.coverage,cases)
  for(const mutation of ['context','owner','native','cold','dataset','phase','source']) {
    const files=['result.json','capacity-context.json','capacity-report.json','capacity-native.log','capacity-cold.log']
    const backups=Object.fromEntries(files.map(name=>[name,fs.readFileSync(path.join(item.run,name))]))
    const lease=fs.readFileSync(path.join(p.session.directory,'capacity-owner.json'))
    if(mutation==='context')p.write(item.relative+'/capacity-context.json',{...item.context,runId:randomUUID()})
    if(mutation==='owner')p.write(p.base+'/capacity-owner.json',{kind:'capacity',owner:'foreign'})
    if(mutation==='native')fs.unlinkSync(path.join(item.run,'capacity-native.log'))
    if(mutation==='cold')p.write(item.relative+'/capacity-cold.log',item.value.logs['capacity-cold.log'].replace("testColdLaunch05]' passed","testColdLaunch05]' skipped"))
    if(mutation==='dataset'){const r=JSON.parse(backups['capacity-report.json']);r.pages.datasetId='foreign';p.write(item.relative+'/capacity-report.json',r)}
    if(mutation==='phase')p.write(item.relative+'/result.json',{...item.result,requested:{kind:'scenario',name:'scale-10000-native'}})
    if(mutation==='source')p.write(item.relative+'/result.json',{...item.result,sourceHash:'f'.repeat(64)})
    assert.throws(check,/封存/,mutation)
    for(const [name,raw]of Object.entries(backups))fs.writeFileSync(path.join(item.run,name),raw)
    fs.writeFileSync(path.join(p.session.directory,'capacity-owner.json'),lease)
  }
  const claimed={...item.result,coverage:[...cases,'check/app-build']}
  p.write(item.relative+'/result.json',claimed)
  assert.deepEqual(check().result.coverage,cases,'容量数据不能冒领未封存的 App 通用构建覆盖')
  const old=proof(p,'registered','case',ids[0],Date.now()-1000)
  for(const [name,raw]of Object.entries(item.value.logs))p.write(old.relative+'/'+name,raw)
  p.write(old.relative+'/capacity-context.json',item.context)
  p.write(old.relative+'/result.json',{...item.result,capacityReport:path.join(old.run,'capacity-report.json')})
  assert.throws(()=>requireEvidence(p.root,old.run,inputHash(p.root),JSON.stringify(environment)),/封存/,'真实容量报告也不能改变 App/UI 原登记类型')
})

test('跨摘要登记终态优先：结果重算为 passed 仍不能覆盖失败/取消/未完成登记',t=>{
  for(const status of ['failed','cancelled','running']) {
    const p=equivalentFixture(t),time=Date.now()-1000
    const item=proof(p,'terminal','case',ids[0],time)
    item.measurement.cases[ids[0]]=equivalentCaseInputs(p.root,[ids[0]])[ids[0]][1]
    p.write(item.relative+'/local-measurement.json',item.measurement)
    registerPartial(p.root,item.run,item.measurement)
    if(status!=='running')recordLocal(p.root,item.run,{...item.result,status:'failed',cancelled:status==='cancelled',failure:{required:['case/'+ids[0]]}})
    item.result.measurementSeal=partialSeal(item.run,item.measurement,item.result)
    p.write(item.relative+'/result.json',item.result)
    assert.throws(()=>validateLocalPartial(p.root,item.run),/登记.*终态/)
    assert.throws(()=>requireEvidence(p.root,item.run,item.result.inputHash,JSON.stringify(environment)),/登记.*终态/)
    const snapshot=partialRuns(p.root)
    assert.ok(partialFailureStatus(p.root,suite,environment,snapshot).failureTimes['case/'+ids[0]])
    assert.equal(aggregatePartials(p.root,suite,environment,snapshot.rows).status,'not-verified')
  }
})

test('原生跨摘要失败同样阻断并由匹配目标修复，真实源码变化不承接旧成功',t=>{
  const p=equivalentFixture(t),time=Date.now()-2000
  const before=nativeProof(p,'beforeNative',time)
  const aliases=equivalentCaseInputs(p.root,[nativeId])[nativeId]
  assert.equal(aliases.length,2)
  const failed=nativeProof(p,'failedNative',time+20,{status:'failed',register:false})
  failed.measurement.cases[nativeId]=aliases[1]
  p.write(failed.relative+'/local-measurement.json',failed.measurement)
  registerPartial(p.root,failed.run,failed.measurement);recordLocal(p.root,failed.run,failed.result)
  const failure=()=>partialFailureStatus(p.root,nativeSuite,environment,partialRuns(p.root))
  assert.equal(failure().failureTimes['case/'+nativeId],time+21)
  nativeProof(p,'repairedNative',time+30)
  assert.equal(failure().failureTimes['case/'+nativeId],undefined)
  assert.doesNotThrow(()=>validateLocalPartial(p.root,before.run))
  p.write('app/src/baseline.ts','export const baseline = 2')
  assert.ok(equivalentCaseInputs(p.root,[nativeId])[nativeId].every(value=>!aliases.includes(value)))
  assert.throws(()=>validateLocalPartial(p.root,before.run),/输入已失效/)
})

test('不能重构的较新登记负结果仍阻断旧绿色，不伪造跨版本修复或接受旧成功',t=>{
  const p=equivalentFixture(t),time=Date.now()-1000
  proof(p,'unknownBefore','scenario','merge-cycle',time)
  const latest=proof(p,'unknownFailure','case',ids[0],time+10)
  latest.measurement.cases[ids[0]]=equivalentCaseInputs(p.root,[ids[0]])[ids[0]][1]
  p.write(latest.relative+'/local-measurement.json',latest.measurement);registerPartial(p.root,latest.run,latest.measurement)
  const failed={...latest.result,status:'failed',failure:{required:['case/'+ids[0]]}}
  p.write(latest.relative+'/result.json',failed);recordLocal(p.root,latest.run,failed)
  // Another independent helper version keeps A unchanged but makes historical B opaque.
  fs.appendFileSync(path.join(p.root,'scripts/fixtures/ios_interaction.py'),'\n# later unrelated helper version\n')
  const inspect=()=>{const snap=partialRuns(p.root);return{partial:aggregatePartials(p.root,suite,environment,snap.rows),failure:partialFailureStatus(p.root,suite,environment,snap)}}
  assert.deepEqual(inspect().partial.missingCases,[ids[0]])
  proof(p,'unknownAfter','case',ids[0],time+20)
  assert.equal(inspect().partial.status,'passed','当前目标须有负结果之后的真实复验')
  assert.equal(inspect().failure.repairs.length,0,'不能声称已证明历史 B 执行等价或清除其锁')
  assert.equal(inspect().failure.failureTimes['case/'+ids[0]],time+11)
})

test('跨摘要准备失败不能靠较晚缓存用例解除，实际重做原阶段后才恢复门禁',t=>{
  const p=equivalentFixture(t,true)
  p.write('app/src/views/me/dictionaries/ProductMergeView.vue','<template>before</template>');const base=p.commit()
  p.write('app/src/views/me/dictionaries/ProductMergeView.vue','<template>after</template>')
  const time=Date.now()-2000,key='native-build/DictionaryTouch/Release'
  proof(p,'phaseBefore','scenario','merge-cycle',time)
  const failed=proof(p,'phaseFailed','case',ids[0],time+10)
  failed.measurement.cases[ids[0]]=equivalentCaseInputs(p.root,[ids[0]])[ids[0]][1]
  p.write(failed.relative+'/local-measurement.json',failed.measurement);registerPartial(p.root,failed.run,failed.measurement)
  const failure={...failed.result,status:'failed',failure:{required:[key]}}
  p.write(failed.relative+'/result.json',failure);recordLocal(p.root,failed.run,failure)
  proof(p,'phaseCached','scenario','merge-cycle',time+20)
  const gate=()=>automaticLocalGate(p.root,base,{readEnvironment:()=>environment}).result.suites.find(row=>row.suite==='ui-merge')
  assert.equal(gate().status,'not-verified','较晚用例通过不能替代真实阶段重做')
  const fresh=proof(p,'phaseBuilt','case',ids[0],time+30)
  fresh.result.coverage.push(key);fresh.result.timings.push({stage:'build',status:'passed',coverage:[key],startedAt:time+30})
  fresh.result.measurementSeal=partialSeal(fresh.run,fresh.measurement,fresh.result)
  p.write(fresh.relative+'/result.json',fresh.result)
  assert.equal(gate().status,'passed')
})

test('未知过渡摘要仍核对登记终态和外层取消/未完成，损坏路由不遮蔽负结果',t=>{
  for(const mutation of ['cancelled','running','completion','route']) {
    const p=equivalentFixture(t),time=Date.now()-2000
    proof(p,'opaqueBefore','scenario','merge-cycle',time)
    const newer=proof(p,'opaqueNewer','case',ids[0],time+10)
    newer.measurement.cases[ids[0]]=equivalentCaseInputs(p.root,[ids[0]])[ids[0]][1]
    p.write(newer.relative+'/local-measurement.json',newer.measurement)
    newer.result.measurementSeal=partialSeal(newer.run,newer.measurement,newer.result)
    p.write(newer.relative+'/result.json',newer.result)
    registerPartial(p.root,newer.run,newer.measurement);recordLocal(p.root,newer.run,newer.result)
    const invocation=JSON.parse(fs.readFileSync(path.join(p.root,newer.measurement.invocation)))
    if(mutation==='cancelled')p.write(newer.measurement.invocation,{...invocation,status:'failed',cancelled:true})
    if(mutation==='running')p.write(newer.measurement.invocation,{...invocation,status:'running',finishedAt:undefined})
    if(mutation==='completion')p.write(newer.relative+'/result.json',{...newer.result,completedAt:time+12})
    if(mutation==='route')p.write(newer.relative+'/local-measurement.json','{"truncated":')
    fs.appendFileSync(path.join(p.root,'scripts/fixtures/ios_interaction.py'),'\n# next unrelated version\n')
    const snapshot=partialRuns(p.root)
    assert.deepEqual(aggregatePartials(p.root,suite,environment,snapshot.rows).missingCases,[ids[0]],mutation)
    assert.equal(partialFailureStatus(p.root,suite,environment,snapshot).failureTimes['case/'+ids[0]],time+11,mutation)
  }
})

test('混合摘要逐目标屏障：失败/取消/未完成/结果丢失不能漏掉变化目标，回退源码不能复活旧绿色',t=>{
  for(const status of ['failed','cancelled','unfinished','missing']) {
    const p=equivalentFixture(t),time=Date.now()-2000
    proof(p,'mixedBefore','scenario','merge-cycle',time)
    const file=path.join(p.root,swiftFile),original=fs.readFileSync(file,'utf8')
    p.write(swiftFile,original.replace('print("cancel")','print("intermediate failing revision")'))
    const newer=proof(p,'mixedNewer','scenario','merge-cycle',time+10)
    registerPartial(p.root,newer.run,newer.measurement)
    if(status!=='unfinished') {
      const failed={...newer.result,status:'failed',cancelled:status==='cancelled',failure:{required:['case/'+ids[0]]}}
      p.write(newer.relative+'/result.json',failed);recordLocal(p.root,newer.run,failed)
    }
    if(status==='unfinished'||status==='missing')fs.unlinkSync(path.join(newer.run,'result.json'))
    p.write(swiftFile,original)
    const inspect=()=>{const snapshot=partialRuns(p.root);return{failure:partialFailureStatus(p.root,suite,environment,snapshot),
      partial:aggregatePartials(p.root,suite,environment,snapshot.rows)}}
    assert.equal(inspect().partial.status,'not-verified',status)
    assert.ok(inspect().partial.missingCases.includes(ids[0]),status)
    assert.equal(inspect().failure.failureTimes['case/'+ids[0]],status==='unfinished'?time+10:time+11,status)
    if(status==='unfinished')for(const id of ids.slice(1))proof(p,'fixed'+id.split('/').at(-1),'case',id,time+20)
    assert.equal(inspect().partial.status,'not-verified','只修复其他目标不能遮蔽未知摘要目标')
    const fresh=proof(p,'mixedAfter','case',ids[0],time+30)
    assert.equal(inspect().partial.status,'passed','当前目标实际复验后可建立当前有效证明')
    assert.ok(inspect().failure.failureTimes['case/'+ids[0]],'未知历史执行不被追认为等价修复')
    assert.ok(readState(p.root).localAttempts[newer.relative],'不清除原登记')
    fs.appendFileSync(path.join(fresh.run,'readback.log'),'tampered')
    assert.equal(inspect().partial.status,'not-verified','恢复后仍须原封存有效')
  }
})

test('Capacity 终态与权威登记：失败/取消/未完成/未收尾和错归属在各局部入口一致拒绝',t=>{
  const p=fixture(t);makeHashable(p);const item=capacityProof(p)
  const file=path.join(item.invocation.run,'result.json'),original=fs.readFileSync(file)
  const consume=()=>requireEvidence(p.root,item.run,inputHash(p.root),JSON.stringify(environment))
  assert.doesNotThrow(consume)
  for(const mutation of ['failed','cancelled','running','owner','time','lock','missing','registration']) {
    const before=JSON.parse(original)
    if(mutation==='failed')p.write(path.relative(p.root,file),{...before,status:'failed'})
    if(mutation==='cancelled')p.write(path.relative(p.root,file),{...before,cancelled:true})
    if(mutation==='running')p.write(path.relative(p.root,file),{...before,status:'running',finishedAt:undefined})
    if(mutation==='owner')p.write(path.relative(p.root,file),{...before,ownerPid:999996})
    if(mutation==='time')p.write(path.relative(p.root,file),{...before,finishedAt:3299})
    if(mutation==='lock')p.write('.local/ios/tmp/ai-agent/ios-command.lock/owner.json',{pid:item.invocation.ownerPid})
    if(mutation==='missing')fs.unlinkSync(file)
    if(mutation==='registration')p.write(item.relative+'/local-measurement.json',{...item.measured,ownerPid:999996})
    assert.throws(consume,/封存/,mutation)
    assert.throws(()=>validateLocalPartial(p.root,item.run),undefined,mutation)
    fs.writeFileSync(file,original)
    if(mutation==='lock')fs.rmSync(path.join(p.root,'.local/ios/tmp/ai-agent/ios-command.lock'),{recursive:true})
    p.write(item.relative+'/local-measurement.json',item.measured)
  }
  const stateFile=path.join(p.root,'.local/ios/tmp/ai-agent/ios-verification-state.json'),state=fs.readFileSync(stateFile)
  const value=JSON.parse(state);delete value.capacityAttempts[item.relative];p.write(path.relative(p.root,stateFile),value)
  assert.throws(consume,/封存/,'仅补造本轮文件不能替代执行前权威登记')
  fs.writeFileSync(stateFile,state);assert.doesNotThrow(consume)
})

test('Capacity 独立登记适配保持 App/UI 原签发器及其输出，重复登记不覆盖失败或跨端接管',async t=>{
  const {partialMeasurement:original}=await import('../lib/ios-local-measurement.mjs')
  const p=fixture(t);makeHashable(p);const now=Date.now,time=now()-1000
  try {
    Date.now=()=>time
    for(const selected of [selection('--case',ids[0],[]),selection('--case',nativeId,[])]) {
      assert.deepEqual(partialMeasurement(p.root,selected,JSON.stringify(environment),p.session),
        original(p.root,selected,JSON.stringify(environment),p.session))
    }
  } finally {Date.now=now}
  const item=capacityProof(p),state=JSON.stringify(readState(p.root))
  assert.throws(()=>registerPartial(p.root,item.run,item.measured),/重复/)
  assert.equal(JSON.stringify(readState(p.root)),state)
  assert.ok(!partialRuns(p.root).rows.some(row=>row.run===item.run),'容量登记不能混成 App/UI 测量')
})

test('Capacity 正式签发与归档和 --from 共用登记/报告/外层终态校验，重算归档摘要不能绕过',async t=>{
  const p=fixture(t,true);makeHashable(p);p.session.context.state='open';p.write(p.base+'/test-context.json',p.session.context);p.commit()
  const item=capacityProof(p),plan=createPlan(p.root,'scale-10000')
  const execute=async name=>{
    const directory=resultsDirectory(p.root,'.local/ios/tmp/ai-agent/ios-ci-'+name,true)
    p.write(path.relative(p.root,path.join(directory,'ci-plan.json')),plan)
    await executeGroup(p.root,directory,'macos',{session:p.session.directory,command:async(_root,_program,args)=>{
      if(args[1]==='debug'&&args[2]==='run')return'EVIDENCE='+item.run+'\n'
      if(args[1]==='debug'&&args[2]==='suspend')return''
      throw Error('unexpected native command')
    }})
    return directory
  }
  const directory=await execute('goodcapacity'),suite=plan.suites[0]
  assert.doesNotThrow(()=>validateSuiteEvidence(p.root,directory,plan,suite))
  for(const [index,mutation]of ['context','owner','terminal','report','registration'].entries()) {
    const file=mutation==='context'?path.join(item.run,'capacity-context.json'):mutation==='owner'?path.join(p.session.directory,'capacity-owner.json'):
      mutation==='terminal'?path.join(item.invocation.run,'result.json'):mutation==='report'?path.join(item.run,'capacity-report.json'):path.join(item.run,'local-measurement.json')
    const bytes=fs.readFileSync(file)
    if(mutation==='terminal')fs.writeFileSync(file,JSON.stringify({...JSON.parse(bytes),status:'failed',cancelled:true}))
    else fs.unlinkSync(file)
    assert.throws(()=>validateSuiteEvidence(p.root,directory,plan,suite),undefined,mutation)
    await assert.rejects(execute('badcapacity'+index),undefined,mutation)
    fs.writeFileSync(file,bytes)
  }
  const receiptFile=path.join(directory,suite.name,'receipt.json'),receipt=JSON.parse(fs.readFileSync(receiptFile))
  const archived=receipt.reports.find(r=>r.role==='primary'&&r.origin.endsWith('/local-measurement.json'))
  const file=path.join(directory,suite.name,archived.path)
  fs.writeFileSync(file,JSON.stringify({...item.measured,ownerPid:999996}));archived.hash=digest(fs.readFileSync(file))
  fs.writeFileSync(receiptFile,JSON.stringify(receipt))
  assert.throws(()=>validateSuiteEvidence(p.root,directory,plan,suite),/归档/,'普通摘要不能替代原登记逐字节对账')
})

test('容量适配共享边界：当前源码须纯透传 App/UI，未知转接/顶层副作用拒绝旧证明，容量内部变化不误失效',async t=>{
  const {assertCapacityDelegation}=await import('../lib/ios-equivalent-evidence.mjs')
  assert.doesNotThrow(()=>assertCapacityDelegation(repository),'实际适配源码必须遵循透明边界')
  const p=equivalentFixture(t),file='scripts/lib/ios-capacity-registration.mjs',original=fs.readFileSync(path.join(repository,file),'utf8')
  p.write(file,original);const measured=equivalentCaseInputs(p.root,ids)
  p.write(file,original.replace("throw new Error('容量执行前命令归属不符。')","throw new Error('capacity-only diagnostic')"))
  assert.deepEqual(equivalentCaseInputs(p.root,ids),measured,'容量分支的独立修改不作废 App/UI')
  for(const changed of [original.replace("selected.scheme !== 'Capacity'","selected.scheme === 'Capacity'"),
    original.replace('return originalMeasurement(root,selected,environment,session,invocation)','return originalMeasurement(root,selected,environment,{...session},invocation)'),
    original.replace("measurement?.kind !== 'capacity'","measurement?.kind === 'capacity'"),
    original+'\nglobalThis.unexpectedSideEffect = true\n']) {
    p.write(file,changed)
    assert.throws(()=>equivalentCaseInputs(p.root,ids),/透传边界/)
    assert.throws(()=>equivalentSuiteInputs(p.root,{kind:'environment'}),/透传边界/)
  }
})

test('委托 AST 语义：分号、注释、引号、括号、单返回块及分离导出不误拦原证明',async t=>{
  const {assertCapacityDelegation}=await import('../lib/ios-equivalent-evidence.mjs')
  const p=equivalentFixture(t),file='scripts/lib/ios-capacity-registration.mjs',source=fs.readFileSync(path.join(repository,file),'utf8')
  p.write(file,source);const before=equivalentCaseInputs(p.root,ids),item=proof(p,'semantic','case',ids[0],Date.now()-1000)
  const state=fs.existsSync(path.join(p.root,'.local/ios/tmp/ai-agent/ios-verification-state.json'))?
    fs.readFileSync(path.join(p.root,'.local/ios/tmp/ai-agent/ios-verification-state.json')):undefined
  const variants=[source.replace(/^(import[^\n]+)$/gm,'$1;'),
    source.replace("if (selected.scheme !== 'Capacity')","if ((selected.scheme) /* same branch */ !== (\"Capacity\"))"),
    source.replace('return originalMeasurement(root,selected,environment,session,invocation)',
      '{ /* same result */ return (originalMeasurement((root), selected, environment, session, invocation)); }'),
    source.replaceAll("'",'"'),
    source.replaceAll('export function ','function ')+"\nexport { partialMeasurement, registerPartial, assertCapacityMeasurement };\n",
    source.replace('readState, writeJson, evidenceRoot, inputHash','inputHash, evidenceRoot, writeJson, readState')]
  for(const [index,changed]of variants.entries()) {
    p.write(file,changed)
    assert.doesNotThrow(()=>assertCapacityDelegation(p.root),String(index))
    assert.deepEqual(equivalentCaseInputs(p.root,ids),before,'格式变化不改变逐目标证明输入')
    assert.doesNotThrow(()=>validateLocalPartial(p.root,item.run),String(index))
    assert.doesNotThrow(()=>requireEvidence(p.root,item.run,inputHash(p.root),JSON.stringify(environment)),String(index))
  }
  if(state)assert.deepEqual(fs.readFileSync(path.join(p.root,'.local/ios/tmp/ai-agent/ios-verification-state.json')),state)
})

test('委托 AST 拒绝边界：三个必需导出、运行时导入及直接返回语义不能缺失或伪装',async t=>{
  const {assertCapacityDelegation}=await import('../lib/ios-equivalent-evidence.mjs')
  const p=equivalentFixture(t),file='scripts/lib/ios-capacity-registration.mjs',source=fs.readFileSync(path.join(repository,file),'utf8')
  const changes=[...['partialMeasurement','registerPartial','assertCapacityMeasurement'].map(name=>source.replace('export function '+name,'function '+name)),
    source.replace('export function partialMeasurement','export default function partialMeasurement'),
    source.replace("selected.scheme !== 'Capacity'","selected.scheme === 'Capacity'"),
    source.replace("selected.scheme !== 'Capacity'","selected.scheme !== 'Cap acity'"),
    source.replace("measurement?.kind !== 'capacity'","measurement.kind !== 'capacity'"),
    source.replace('return originalMeasurement(root,selected,environment,session,invocation)','return originalMeasurement(root,selected,environment,{...session},invocation)'),
    source.replace('root, selected, environment, session, invocation','root, selected, environment, session, invocation = sideEffect()'),
    source.replace('import { partialMeasurement as originalMeasurement','import type { partialMeasurement as originalMeasurement'),
    source.replace("from './ios-local-measurement.mjs'","from './ios-local- measurement.mjs'"),
    source+"\nexport { partialMeasurement };\n",source+"\nsideEffect();\n"]
  for(const [index,changed]of changes.entries()) {
    p.write(file,changed)
    assert.throws(()=>assertCapacityDelegation(p.root),/透传边界/,String(index))
    assert.throws(()=>equivalentCaseInputs(p.root,ids),/透传边界/,String(index))
  }
})

test('委托模块归属：缺失或链接不能冒充旧版本，旧路由须正向证明且无适配依赖',async t=>{
  const {assertCapacityDelegation}=await import('../lib/ios-equivalent-evidence.mjs')
  const p=equivalentFixture(t),file='scripts/lib/ios-capacity-registration.mjs',full=path.join(p.root,file)
  const item=proof(p,'moduleOwner','case',ids[0],Date.now()-1000),source=fs.readFileSync(full)
  fs.unlinkSync(full)
  assert.throws(()=>assertCapacityDelegation(p.root),/透传边界/,'现代转接仍引用适配层，不能因文件缺失放行')
  assert.throws(()=>validateLocalPartial(p.root,item.run),/透传边界/)
  const outside=p.write('.local/adapter.mjs',source.toString())
  fs.symlinkSync(outside,full);assert.throws(()=>assertCapacityDelegation(p.root),/透传边界/)
  fs.unlinkSync(full);fs.symlinkSync(path.join(p.root,'missing.mjs'),full)
  assert.throws(()=>assertCapacityDelegation(p.root));fs.unlinkSync(full)
  const route='scripts/lib/ios-local-partials.mjs',legacy="export {partialMeasurement,registerPartial} from './ios-local-measurement.mjs';\n"
  p.write(route,legacy)
  p.write('scripts/lib/ios-local-measurement.mjs','export function partialMeasurement() {}\nexport function registerPartial() {}\n')
  assert.doesNotThrow(()=>assertCapacityDelegation(p.root),'原签发器的明确旧路由可用，不补造适配登记')
  p.write(route,legacy+"import { read } from './legacy-reader.mjs';\n")
  p.write('scripts/lib/legacy-reader.mjs',"export function read() { return 1 }\n")
  assert.doesNotThrow(()=>assertCapacityDelegation(p.root),'已有且不引用适配层的旧消费依赖仍可用')
  p.write('scripts/lib/legacy-reader.mjs',"export {partialMeasurement} from './ios-capacity-registration.mjs';\n")
  assert.throws(()=>assertCapacityDelegation(p.root),/透传边界/,'间接残留适配引用不能冒充旧版本')
  p.write('scripts/lib/legacy-reader.mjs',"const name='ios-capacity-registration'; import('./'+name+'.mjs');\n")
  assert.throws(()=>assertCapacityDelegation(p.root),/透传边界/,'未知计算导入不能证明无适配依赖')
  p.write(route,"export * from './ios-local-measurement.mjs';\n")
  assert.throws(()=>assertCapacityDelegation(p.root),/透传边界/,'未知公开路由不直接追认为旧版本')
  fs.unlinkSync(path.join(p.root,route));assert.throws(()=>assertCapacityDelegation(p.root))
})

test('委托 AST 绑定：后置函数/var/词法声明不能遮蔽导入或实参，独立容量块和嵌套函数不误拦',async t=>{
  const {assertCapacityDelegation}=await import('../lib/ios-equivalent-evidence.mjs')
  const p=equivalentFixture(t),file='scripts/lib/ios-capacity-registration.mjs',source=fs.readFileSync(path.join(repository,file),'utf8')
  for(const declaration of [
    'function originalMeasurement() { return null }',
    'var originalMeasurement;',
    'const originalMeasurement = () => null;',
    "if (selected.scheme === 'Capacity') { var originalMeasurement; }",
    'var { value: originalMeasurement } = {};',
    'function session() {}',
    'class originalMeasurement {}']) {
    p.write(file,source.replace('  const suffix',declaration+'\n  const suffix'))
    assert.throws(()=>assertCapacityDelegation(p.root),/透传边界/,declaration)
  }
  for(const declaration of [
    "if (selected.scheme === 'Capacity') { const originalMeasurement = null; }",
    'const capacityOnly = () => { var originalMeasurement; };',
    'for (let originalMeasurement of []) {}',
    'var session;',
    ';']) {
    p.write(file,source.replace('  const suffix',declaration+'\n  const suffix'))
    assert.doesNotThrow(()=>assertCapacityDelegation(p.root),declaration)
  }
})

test('旧版依赖图必须完整：直接/间接导入与重导出缺文件均拒绝，旧证明及原登记不被改写',async t=>{
  const {assertCapacityDelegation}=await import('../lib/ios-equivalent-evidence.mjs')
  const p=fixture(t),route='scripts/lib/ios-local-partials.mjs'
  p.write('scripts/lib/ios-local-measurement.mjs','export function partialMeasurement() {}\nexport function registerPartial() {}\n')
  const original=fs.readFileSync(path.join(p.root,route),'utf8')
  const item=proof(p,'incompleteLegacy','case',ids[0],Date.now()-1000)
  registerPartial(p.root,item.run,item.measurement);recordLocal(p.root,item.run,item.result)
  const stateFile=path.join(p.root,'.local/ios/tmp/ai-agent/ios-verification-state.json'),state=fs.readFileSync(stateFile)
  const report=fs.readFileSync(path.join(item.run,'result.json'))
  assert.doesNotThrow(()=>assertCapacityDelegation(p.root))
  for(const [index,extra]of ["import {read} from './missing-reader.mjs';", "export {read} from './missing-reader.mjs';", "import {read} from './legacy-reader.mjs';"].entries()) {
    p.write(route,original+extra+'\n')
    if(index===2)p.write('scripts/lib/legacy-reader.mjs',"export {read} from './missing-reader.mjs';\n")
    assert.throws(()=>assertCapacityDelegation(p.root),/透传边界/,extra)
    assert.throws(()=>validateLocalPartial(p.root,item.run),/透传边界/,extra)
    assert.throws(()=>requireEvidence(p.root,item.run,inputHash(p.root),JSON.stringify(environment)),undefined,extra)
    assert.deepEqual(fs.readFileSync(stateFile),state)
    assert.deepEqual(fs.readFileSync(path.join(item.run,'result.json')),report)
  }
  p.write(route,original+"import {read} from './legacy-reader.mjs';\n")
  p.write('scripts/lib/missing-reader.mjs','export const read = 1;\n')
  assert.doesNotThrow(()=>assertCapacityDelegation(p.root),'依赖齐全、无适配引用的旧结构恢复可核验')
  assert.doesNotThrow(()=>validateLocalPartial(p.root,item.run))
})

test('类静态块拥有独立 var 作用域：声明/表达式局部绑定不误拦，外层类/var 遮蔽仍拒绝',async t=>{
  const {assertCapacityDelegation}=await import('../lib/ios-equivalent-evidence.mjs')
  const p=equivalentFixture(t),file='scripts/lib/ios-capacity-registration.mjs',source=fs.readFileSync(path.join(repository,file),'utf8')
  const ts=createRequire(new URL('../../app/package.json',import.meta.url))('typescript')
  const item=proof(p,'classScope','case',ids[0],Date.now()-1000)
  for(const declaration of ['class CapacityOnly { static { var originalMeasurement; } }',
    'const CapacityOnly = class { static { var originalMeasurement; } };',
    'class CapacityOnly { static { var {value: originalMeasurement} = {}; var session; } }']) {
    const changed=source.replace('  const suffix',declaration+'\n  const suffix')
    p.write(file,changed)
    const parsed=ts.createSourceFile('adapter.mjs',changed,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
    const fn=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='partialMeasurement')
    for(const scheme of ['App','DictionaryTouch'])assert.equal(vm.runInNewContext(
      'const originalMeasurement=()=>"original-ok";'+fn.getText(parsed).replace(/^export /,'')+
      ';partialMeasurement("root",{scheme:'+JSON.stringify(scheme)+'},"env",{},{});'),'original-ok')
    assert.doesNotThrow(()=>assertCapacityDelegation(p.root),declaration)
    assert.doesNotThrow(()=>validateLocalPartial(p.root,item.run),declaration)
  }
  for(const declaration of ['class originalMeasurement { static { var session; } }',
    'var originalMeasurement; class CapacityOnly { static { var originalMeasurement; } }']) {
    p.write(file,source.replace('  const suffix',declaration+'\n  const suffix'))
    assert.throws(()=>assertCapacityDelegation(p.root),/透传边界/,declaration)
  }
})
