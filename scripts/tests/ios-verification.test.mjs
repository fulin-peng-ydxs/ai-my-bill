import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { selection, APP_ID } from '../lib/ios-debug.mjs'
import { controlInputs, inputHash, verificationHash, requireEvidence, beginFull, finishFull, requireActiveFull,
  observeFull, startPhase, finishPhases, recordLocal, readState, needsPhaseRepair, caseKey, failureDetails, readVitest } from '../lib/ios-verification.mjs'
import { checkDefinition } from '../lib/ios-checks.mjs'
const environment = JSON.stringify({ sdk: '27.0', xcode: 'Xcode 27.0\n', node: process.version, arch: process.arch, host: os.release(), runtime: 'TEST' })
const ui = name => 'DictionaryUITests/DictionaryTouchTests/' + name
const target = ui('test02RenameProduct')
function project(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ios-verification-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (relative, text) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file }
  for (const relative of controlInputs) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.cpSync(new URL('../../' + relative, import.meta.url), file, { recursive: true })
  }
  for (const name of ['app/src/view.vue','app/src/domain/money.spec.ts','app/native-tests/probe.ts','app/test-support/scenario.ts','app/ios/App/project.pbxproj',
    'app/package.json','app/package-lock.json','app/capacitor.config.ts','app/vite.config.ts','app/tsconfig.json','app/tsconfig.tools.json','scripts/normalize-capacitor-spm.mjs']) write(name, 'fixture')
  const scenarios = JSON.parse(fs.readFileSync(new URL('../../app/native-tests/scenarios.json', import.meta.url)))
  write('app/native-tests/scenarios.json', JSON.stringify(scenarios))
  const base = path.join(root, '.local/ios/tmp/ai-agent'); fs.mkdirSync(base, { recursive: true })
  const session = fs.mkdtempSync(path.join(base, 'ios-debug-')), runId = randomUUID(), simulatorId = randomUUID()
  fs.writeFileSync(path.join(session, 'test-context.json'), JSON.stringify({ schema:1,kind:'ios-debug',state:'open',runId,simulatorId,appId:APP_ID,name:`我的账单调试-${runId}` }), { mode:0o600 })
  function evidence(name = target, overrides = {}) {
    const kind = name.startsWith('interruption-') ? 'scenario' : 'case'
    const selected = selection('--' + kind, name, scenarios), run = fs.mkdtempSync(path.join(session, 'run-'))
    const coverage = selected.recoveryPhases ? selected.recoveryPhases.map(p => 'recovery/' + p) : selected.cases.map(caseKey)
    const result = { scope:'partial',status:'passed',requested:{kind,name},executedCases:selected.cases,coverage,
      runId,simulatorId,inputHash:inputHash(root),environment,completedAt:Date.now(),...overrides }
    fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result))
    const log = selected.recoveryPhases ? selected.recoveryPhases.map(p => 'LEDGER_PROCESS_INTERRUPTION_RECOVERED ' + p).join('\n')
      : selected.cases.map(id => `Test Case '-[${id.split('/')[0]}.${id.split('/')[1]} ${id.split('/')[2]}]' passed (0.1 seconds).`).join('\n')
        + `\nExecuted ${selected.cases.length} test${selected.cases.length === 1 ? '' : 's'}, with 0 failures\n`
    fs.writeFileSync(path.join(run, 'test.log'), log)
    return { run, result }
  }
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin)
  const executable = (name, code) => { const file = write('bin/' + name, code); fs.chmodSync(file, 0o755) }
  const devices = JSON.stringify({devices:{'com.apple.CoreSimulator.SimRuntime.iOS-27-0':[{udid:simulatorId,name:`我的账单调试-${runId}`,isAvailable:true,deviceTypeIdentifier:'com.apple.CoreSimulator.SimDeviceType.iPhone-14-Pro-Max',state:'Shutdown'}]}})
  executable('xcrun', `#!/bin/sh
if [ \"$3\" = \"devices\" ]; then printf '%s\\n' '${devices}'; elif [ \"$1\" = \"simctl\" ]; then printf '%s\\n' '{"runtimes":[{"identifier":"com.apple.CoreSimulator.SimRuntime.iOS-27-0","isAvailable":true,"buildversion":"TEST"}]}'; else printf '27.0\\n'; fi
`)
  executable('xcodebuild', '#!/bin/sh\nprintf "Xcode 27.0\\n"\n')
  executable('npm', `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const output=process.argv.find(a=>a.startsWith('--outputFile='));
if(output && process.argv.includes('--testNamePattern=absent')){fs.writeFileSync(output.slice('--outputFile='.length),JSON.stringify({testResults:[],numTotalTests:0}));process.exit(0)}
if(output){const failed=fs.existsSync('fail-local');fs.writeFileSync(output.slice('--outputFile='.length),JSON.stringify({testResults:[{name:path.resolve('app/src/domain/money.spec.ts'),assertionResults:[{fullName:'money sum',status:failed?'failed':'passed'}]}]}));process.exit(failed?1:0)}
process.exit(0)
`)
  write('scripts/verify-ios-resources.mjs', "console.log('resources verified')\n")
  const env = { ...process.env, PATH:bin + path.delimiter + process.env.PATH, CI:'true',MYBILL_FULL_ATTEMPT:'/forged' }
  const run = args => spawnSync(process.execPath, [path.join(root,'scripts/ios-app.mjs'),...args], {cwd:root,env,encoding:'utf8',timeout:12000})
  return { root,write,base,session,evidence,run,hash:()=>verificationHash(root,environment),context:()=>({inputHash:inputHash(root),environment}) }
}
function clock(t) { let time=100000; t.mock.method(Date,'now',()=>++time) }
function finishAttempt(p, hash, proof, failed = true, required = [target]) {
  const a=beginFull(p.root,'ios-touch',proof,hash,process.pid,p.context())
  finishFull(p.root,a,failed?new Error('controlled failure'):undefined,failed?required:[])
  return a
}

test('当前局部证据校验：失败/旧输入/错误环境/范围/符号链接拒绝，文档变化不作废', t=>{
  const p=project(t), good=p.evidence(), read=run=>requireEvidence(p.root,run,inputHash(p.root),environment)
  assert.equal(read(good.run).run,good.run); assert.throws(()=>read(undefined),/--from/)
  for(const overrides of [{status:'failed'},{inputHash:'old'},{environment:'different'},{coverage:[]},{executedCases:[]},{coverage:[...good.result.coverage,'app-test/other.spec.ts#unrelated']}]) assert.throws(()=>read(p.evidence(target,overrides).run))
  const link=path.join(p.session,'run-link');fs.symlinkSync(good.run,link);assert.throws(()=>read(link))
  p.write('README.md','docs');assert.equal(read(good.run).run,good.run)
  fs.appendFileSync(path.join(p.root,'scripts/fixtures/dictionary-touch.py'),'# changed');assert.throws(()=>read(good.run),/版本不符/)
})

test('A→B→A 保留 A 的初验/复验次数，已通过 A→B→A 也不重复', t=>{
  clock(t);const p=project(t),A='a'.repeat(64),B='b'.repeat(64)
  finishAttempt(p,A,p.evidence());finishAttempt(p,A,p.evidence());assert.throws(()=>finishAttempt(p,A,p.evidence()),/初验及一次复验/)
  finishAttempt(p,B,p.evidence());assert.throws(()=>finishAttempt(p,A,p.evidence()),/初验及一次复验/)
  const q=project(t);finishAttempt(q,A,q.evidence(),false);finishAttempt(q,B,q.evidence(),false)
  assert.throws(()=>finishAttempt(q,A,q.evidence(),false),/拒绝重复/)
})

test('v1 历史回执迁移保留其他版本次数及最近失败，不清空旧记录', t=>{
  clock(t);const p=project(t),A='a'.repeat(64),B='b'.repeat(64)
  const a=finishAttempt(p,A,p.evidence());finishAttempt(p,A,p.evidence());const b=finishAttempt(p,B,p.evidence())
  p.write('.local/ios/tmp/ai-agent/ios-verification-state.json',JSON.stringify({schema:1,attempts:{'ios-touch':readState(p.root).attempts['ios-touch']}}))
  const migrated=readState(p.root);assert.equal(migrated.schema,2);assert.ok(migrated.history.some(v=>v.run===a.run));assert.ok(migrated.history.some(v=>v.run===b.run))
  assert.throws(()=>finishAttempt(p,A,p.evidence()),/初验及一次复验/)
})

test('已有成功后，新局部真实失败及相关修复可复验；无故刷绿色、旧/无关证据拒绝', t=>{
  clock(t);const p=project(t),H=p.hash();finishAttempt(p,H,p.evidence(),false)
  assert.throws(()=>finishAttempt(p,H,p.evidence(),false),/拒绝重复/)
  const failure=p.evidence(target,{status:'failed',failure:{required:[caseKey(target)]}})
  recordLocal(p.root,failure.run,failure.result)
  assert.throws(()=>finishAttempt(p,H,p.evidence(ui('test07RestoreCandidates')),false),/相关局部/)
  const repair=p.evidence();const repeated=finishAttempt(p,H,repair,false);assert.ok(repeated.incident.startsWith('local:'))
  assert.throws(()=>finishAttempt(p,H,p.evidence(),false),/拒绝重复/)
  const secondFailure=p.evidence(target,{status:'failed',failure:{required:[caseKey(target)]}})
  recordLocal(p.root,secondFailure.run,secondFailure.result)
  finishAttempt(p,H,p.evidence(),true)
  assert.throws(()=>beginFull(p.root,'ios-smoke',p.evidence('NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection'),H,process.pid,p.context()),/先处理/)
})

test('失败锁保留目标，换套件/旧回执拒绝；特殊恢复可用同阶段成对场景解锁', t=>{
  clock(t);const p=project(t),H=p.hash(),proof=p.evidence();finishAttempt(p,H,proof)
  assert.throws(()=>finishAttempt(p,H,proof),/相关局部/)
  assert.throws(()=>beginFull(p.root,'ios-smoke',p.evidence(),H,process.pid,p.context()),/先处理/)
  const q=project(t),native='NativeTests/NativeSqliteTests/testLedgerLifecycleAndProtection'
  const a=beginFull(q.root,'ios-smoke',q.evidence(native),H,process.pid,q.context())
  startPhase(a.run,{stage:'test',coverage:['recovery/migration-recorded'],log:path.join(q.base,'recovery.log')})
  finishFull(q.root,a,new Error('recover failed'),['NativeTests/NativeSqliteTests/testRecoverProcessInterruption'])
  assert.throws(()=>beginFull(q.root,'ios-smoke',q.evidence('interruption-snapshot-ready'),H,process.pid,q.context()),/相关局部/)
  const related=q.evidence('interruption-migration-recorded');requireEvidence(q.root,related.run,inputHash(q.root),environment)
  assert.equal(beginFull(q.root,'ios-smoke',related,H,process.pid,q.context()).retry,1)
  assert.throws(()=>selection('--case','NativeTests/NativeSqliteTests/testRecoverProcessInterruption',[]))
})

test('构建/安装/启动/单用例分别计时，长构建不误耗启动预算；预期中断失败不误停', t=>{
  const p=project(t),run=fs.mkdtempSync(path.join(p.base,'ios-full-')),log=p.write('.local/ios/tmp/ai-agent/native-clock/test.log','')
  let time=1000;t.mock.method(Date,'now',()=>time)
  const w=observeFull({run,root:p.root,evidenceRoot:p.base},{now:()=>time})
  startPhase(run,{stage:'build',coverage:['native-build/App/Debug'],log});time+=200000;w.poll()
  startPhase(run,{stage:'install',coverage:['native-install/App/Debug'],log});time+=100000;w.poll()
  startPhase(run,{stage:'test',coverage:['native-startup/App/Debug'],log});time+=100000;w.poll()
  fs.writeFileSync(log,`Test Case '-[DictionaryUITests.DictionaryTouchTests test02RenameProduct]' started.\n`);w.poll();time+=61000;assert.throws(()=>w.poll(),/60 秒/)
  assert.deepEqual(w.failedCases,[target]);const times=finishPhases(run,new Error('timeout'));assert.equal(times[0].elapsedMs,200000);assert.equal(times[1].elapsedMs,100000)
  const guard=fs.mkdtempSync(path.join(p.base,'ios-full-'));startPhase(guard,{stage:'test',coverage:['recovery/snapshot-ready'],log,expectedFailure:true})
  fs.writeFileSync(log,"Test Case '-[NativeTests.NativeSqliteTests testPrepareProcessInterruption]' failed (1 seconds).\n")
  observeFull({run:guard,evidenceRoot:p.base},{now:()=>time}).poll()
  time+=121000;assert.throws(()=>observeFull({run:guard,evidenceRoot:p.base},{now:()=>time}).poll(),/中断准备阶段超时/)
})

test('各阶段超时与没有进入测试的启动超时明确分类，阶段内日志分块仍识别首败', t=>{
  const p=project(t);let now=1000;t.mock.method(Date,'now',()=>now)
  for(const [stage,elapsed]of[['build',600001],['install',120001],['test',180001]]){
    const run=fs.mkdtempSync(path.join(p.base,'ios-full-')),log=p.write('.local/ios/tmp/ai-agent/native-'+stage+'/test.log','')
    startPhase(run,{stage,coverage:['native-startup/App/Debug'],log});now+=elapsed
    assert.throws(()=>observeFull({run,evidenceRoot:p.base},{now:()=>now}).poll(),stage==='test'?/测试启动阶段/:new RegExp(stage+' 阶段超时'))
  }
  const run=fs.mkdtempSync(path.join(p.base,'ios-full-')),log=p.write('.local/ios/tmp/ai-agent/native-split/test.log',"Test Case '-[DictionaryUITests.DictionaryTouchTests test02RenameProduct]' fa")
  startPhase(run,{stage:'test',coverage:[caseKey(target)],log});const w=observeFull({run,evidenceRoot:p.base});w.poll();fs.appendFileSync(log,'iled (1 seconds).\n');assert.throws(()=>w.poll(),/立即停止/)
})

test('Vitest、资源及编译失败保留所属层次，不降级成原生入口绿色；检查命令拒绝任意路径',t=>{
  const p=project(t),run=fs.mkdtempSync(path.join(p.base,'ios-check-')),report=p.write('.local/ios/tmp/ai-agent/report.json',JSON.stringify({testResults:[{name:path.join(p.root,'app/src/domain/money.spec.ts'),assertionResults:[{fullName:'money sum',status:'failed'}]}]}))
  startPhase(run,{stage:'check',coverage:['check/app-tests'],report});assert.deepEqual(failureDetails({run,root:p.root}).required,['app-test/src/domain/money.spec.ts#money sum'])
  assert.throws(()=>checkDefinition(p.root,run,'app-tests',{file:'../private.spec.ts'}));assert.throws(()=>checkDefinition(p.root,run,'resources',{scheme:'App'}))
  assert.throws(()=>checkDefinition(p.root,run,'native-build',{scheme:'Unknown'}));assert.throws(()=>checkDefinition(p.root,run,'resources',{target:'arbitrary'}))
  startPhase(run,{stage:'build',coverage:['native-build/DictionaryTouch/Release']});assert.deepEqual(failureDetails({run,root:p.root}).required,['native-build/DictionaryTouch/Release'])
})

test('真实 CLI 首败取消、执行清理并拒绝无关证据；最低层局部修复可解锁', {timeout:20000},t=>{
  const p=project(t)
  p.write('scripts/lib/ios-app-full.sh',`#!/bin/bash
set -e
trap 'echo cleaned > cleanup-receipt; exit 143' TERM INT
mkdir -p .local/ios/tmp/ai-agent/native-controlled
LOG="$PWD/.local/ios/tmp/ai-agent/native-controlled/test.log"
node scripts/lib/ios-verification.mjs phase ios-touch "$MYBILL_FULL_ATTEMPT" test case/${target} "$LOG"
printf "Test Case '-[DictionaryUITests.DictionaryTouchTests test02RenameProduct]' failed (0.1 seconds).\\n" > "$LOG"
sleep 5
echo SHOULD_NOT_CONTINUE > continued
`)
  const proof=p.evidence(),failed=p.run(['ios-touch','--from',proof.run]);assert.equal(failed.status,1,failed.stderr);assert.match(failed.stderr,/立即停止/)
  assert.ok(fs.existsSync(path.join(p.root,'cleanup-receipt')));assert.equal(fs.existsSync(path.join(p.root,'continued')),false)
  assert.equal(fs.existsSync(path.join(p.base,'ios-command.lock')),false)
  assert.equal(p.run(['ios-touch','--from',proof.run]).status,1)
  const other=p.run(['ios-touch','--from',p.evidence(ui('test07RestoreCandidates')).run]);assert.match(other.stderr,/相关局部/)
})

test('真实 CLI 无需 Xcode 的精确 Vitest 局部修复解锁同层失败，新故障可复验但不无限重跑', {timeout:20000},t=>{
  const p=project(t)
  p.write('scripts/lib/ios-app-full.sh',`#!/bin/bash
set -e
if [[ -f allow-pass ]]; then exit 0; fi
mkdir -p .local/ios/tmp/ai-agent/native-unit
LOG="$PWD/.local/ios/tmp/ai-agent/native-unit/test.log"
REPORT="$PWD/.local/ios/tmp/ai-agent/native-unit/vitest.json"
node scripts/lib/ios-verification.mjs phase ios-touch "$MYBILL_FULL_ATTEMPT" check check/app-tests "$LOG" "$REPORT"
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({testResults:[{name:process.cwd()+"/app/src/domain/money.spec.ts",assertionResults:[{fullName:"money sum",status:"failed"}]}]}))' "$REPORT"
exit 1
`)
  const first=p.run(['debug','check','--check','resources']);assert.equal(first.status,0,first.stderr)
  const from=text=>text.match(/^EVIDENCE=(.+)$/m)[1]
  const proof=from(first.stdout);const full=p.run(['ios-touch','--from',proof]);assert.equal(full.status,1)
  const unrelated=p.run(['ios-touch','--from',p.evidence(ui('test00EightOriginalEntries')).run]);assert.match(unrelated.stderr,/app-test.*money sum/)
  p.write('allow-pass','fixed environment')
  const local=p.run(['debug','check','--check','app-tests','--file','src/domain/money.spec.ts','--name','money sum']);assert.equal(local.status,0,local.stderr)
  const moneyProof=from(local.stdout);assert.equal(p.run(['ios-touch','--from',moneyProof]).status,0)
  assert.match(p.run(['ios-touch','--from',moneyProof]).stderr,/拒绝重复/)
  const zero=p.run(['debug','check','--check','app-tests','--name','absent']);assert.equal(zero.status,1)
  const justGreen=p.run(['debug','check','--check','app-tests']);assert.equal(justGreen.status,0,justGreen.stderr)
  assert.match(p.run(['ios-touch','--from',from(justGreen.stdout)]).stderr,/拒绝重复/)
  p.write('fail-local','newly observed failure');assert.equal(p.run(['debug','check','--check','app-tests','--file','src/domain/money.spec.ts']).status,1)
  fs.unlinkSync(path.join(p.root,'fail-local'))
  const repaired=p.run(['debug','check','--check','app-tests','--file','src/domain/money.spec.ts']);assert.equal(repaired.status,0,repaired.stderr)
  assert.equal(p.run(['ios-touch','--from',from(repaired.stdout)]).status,0)
  assert.match(p.run(['ios-touch','--from',from(repaired.stdout)]).stderr,/拒绝重复/)
})

test('内部许可绑定工作区锁、存活进程与模式，直接内部调用拒绝',t=>{
  const p=project(t),a=beginFull(p.root,'ios-touch',p.evidence(),p.hash(),process.pid,p.context())
  assert.throws(()=>requireActiveFull(p.root,'ios-touch',a.run));p.write('.local/ios/tmp/ai-agent/ios-command.lock/owner.json',JSON.stringify({pid:process.pid}))
  assert.equal(requireActiveFull(p.root,'ios-touch',a.run).run,a.run);assert.throws(()=>requireActiveFull(p.root,'ios-smoke',a.run));finishFull(p.root,a)
  assert.throws(()=>requireActiveFull(p.root,'ios-touch',a.run))
})

test('真实 CLI 成对恢复局部入口只接受受管阶段，结束后回收活动许可并生成可用证据', {timeout:15000, skip:process.platform !== 'darwin'}, t=>{
  const p=project(t)
  p.write('scripts/lib/ios-app-full.sh', `#!/bin/bash
set -e
node scripts/lib/ios-verification.mjs permit ios-recovery "$MYBILL_FULL_ATTEMPT"
IFS=',' read -r -a phases <<< "$MYBILL_RECOVERY_PHASES"
for item in "\${phases[@]}"; do echo "LEDGER_PROCESS_INTERRUPTION_RECOVERED $item"; done
`)
  const run=p.run(['debug','run','--session',p.session,'--scenario','interruption-migration-recorded'])
  assert.equal(run.status,0,run.stderr + run.stdout + fs.readdirSync(p.session).filter(n=>n.startsWith("run-")).map(n=>fs.readFileSync(path.join(p.session,n,"test.log"),"utf8")).join("\n"))
  const proof=run.stdout.match(/^EVIDENCE=(.+)$/m)[1]
  assert.ok(!fs.existsSync(path.join(proof,'active.json')))
  const evidence=requireEvidence(p.root,proof,inputHash(p.root),environment)
  assert.ok(evidence.result.coverage.includes('recovery/migration-recorded'))
  assert.ok(!evidence.result.coverage.includes('recovery/snapshot-ready'))
  const closed = p.run(['debug', 'close', '--session', p.session])
  assert.equal(closed.status, 0, closed.stderr)
  assert.equal(JSON.parse(fs.readFileSync(path.join(p.session, 'test-context.json'))).state, 'closed')
})


test('本机阶段新失败强制重做，相关成功后恢复缓存但仍保留故障复验依据', t => {
  clock(t)
  const p = project(t), key = 'native-install/App/Debug', H = p.hash()
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
