import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { selection, APP_ID } from '../lib/ios-debug.mjs'
import { controlInputs, verificationHash, requireEvidence, beginFull, finishFull, requireActiveFull, observeFull } from '../lib/ios-verification.mjs'

const toolchain = '27.0Xcode 27.0\n' + process.version
const ui = name => 'DictionaryUITests/DictionaryTouchTests/' + name
function project(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ios-verification-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (relative, text) => {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text)
    return file
  }
  for (const relative of controlInputs) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.cpSync(new URL('../../' + relative, import.meta.url), target, { recursive: true })
  }
  for (const file of ['app/src/view.vue', 'app/native-tests/probe.ts', 'app/test-support/scenario.ts', 'app/ios/App/project.pbxproj',
    'app/package.json', 'app/package-lock.json', 'app/capacitor.config.ts', 'app/vite.config.ts', 'app/tsconfig.json', 'app/tsconfig.tools.json', 'scripts/normalize-capacitor-spm.mjs']) write(file, 'fixture')
  const scenarios = JSON.parse(fs.readFileSync(new URL('../../app/native-tests/scenarios.json', import.meta.url)))
  write('app/native-tests/scenarios.json', JSON.stringify(scenarios))
  const sessions = path.join(root, '.local/ios/tmp/ai-agent'); fs.mkdirSync(sessions, { recursive: true })
  const session = fs.mkdtempSync(path.join(sessions, 'ios-debug-'))
  const runId = randomUUID(), simulatorId = randomUUID()
  const context = { schema: 1, kind: 'ios-debug', state: 'open', runId, simulatorId, appId: APP_ID, name: `我的账单调试-${runId}` }
  fs.writeFileSync(path.join(session, 'test-context.json'), JSON.stringify(context), { mode: 0o600 })
  function evidence(method = 'test02RenameProduct', overrides = {}) {
    const name = method.includes('/') ? method : ui(method)
    const selected = selection('--case', name, scenarios)
    const run = fs.mkdtempSync(path.join(session, 'run-'))
    const result = { scope: 'partial', status: 'passed', requested: { kind: 'case', name },
      executedCases: selected.cases, runId, simulatorId, completedAt: Date.now(), verificationHash: verificationHash(root, toolchain), ...overrides }
    fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result))
    fs.writeFileSync(path.join(run, 'test.log'), selected.cases.map(id => `Test Case '-[${id.split('/')[0]}.${id.split('/')[1]} ${id.split('/')[2]}]' passed (0.1 seconds).`).join('\n')
      + `\nExecuted ${selected.cases.length} test${selected.cases.length === 1 ? '' : 's'}, with 0 failures\n`)
    return { run, result }
  }
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin)
  for (const [name, output] of [['xcrun', '27.0'], ['xcodebuild', 'Xcode 27.0']]) {
    const file = write('bin/' + name, '#!/bin/sh\nprintf "' + output + '\\n"\n'); fs.chmodSync(file, 0o755)
  }
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, CI: 'true', MYBILL_FULL_ATTEMPT: '/forged' }
  const run = args => spawnSync(process.execPath, [path.join(root, 'scripts/ios-app.mjs'), ...args], { cwd: root, env, encoding: 'utf8', timeout: 10_000 })
  return { root, write, evidence, sessions, session, run }
}

test('证据入口拒绝缺失、失败、旧版、篡改范围、越界及符号链接；执行器/夹具变化也作废', t => {
  const p = project(t), hash = () => verificationHash(p.root, toolchain)
  assert.throws(() => requireEvidence(p.root, undefined, hash()), /--from/)
  const good = p.evidence(); assert.equal(requireEvidence(p.root, good.run, hash()).run, good.run)
  for (const overrides of [{ status: 'failed' }, { verificationHash: 'old' }, { completedAt: Date.now() + 60_000 }, { executedCases: [ui('test07RestoreCandidates')] }]) {
    assert.throws(() => requireEvidence(p.root, p.evidence('test02RenameProduct', overrides).run, hash()))
  }
  const link = path.join(p.session, 'run-link'); fs.symlinkSync(good.run, link)
  assert.throws(() => requireEvidence(p.root, link, hash()))
  assert.throws(() => requireEvidence(p.root, p.root, hash()))
  assert.throws(() => beginFull(p.root, 'ios-smoke', good, hash(), process.pid), /类型不匹配/)
  fs.appendFileSync(path.join(p.root, 'scripts/fixtures/dictionary-touch.py'), '\n# modified')
  assert.throws(() => requireEvidence(p.root, good.run, hash()), /版本不符/)
  const current = p.evidence(); assert.equal(requireEvidence(p.root, current.run, hash()).run, current.run)
  p.write('README.md', 'documentation only'); assert.equal(requireEvidence(p.root, current.run, hash()).run, current.run)
})

test('成功后同输入禁止重复；新局部绿色不能伪装成新风险；代码或工具链变化须新证据', t => {
  const p = project(t), hash = verificationHash(p.root, toolchain), proof = p.evidence()
  const first = beginFull(p.root, 'ios-touch', proof, hash, process.pid); finishFull(p.root, first)
  assert.throws(() => beginFull(p.root, 'ios-touch', p.evidence(), hash, process.pid), /拒绝重复/)
  assert.notEqual(verificationHash(p.root, toolchain + 'changed'), hash)
  fs.appendFileSync(path.join(p.root, 'app/src/view.vue'), 'changed')
  const next = verificationHash(p.root, toolchain), fresh = p.evidence()
  assert.throws(() => requireEvidence(p.root, proof.run, next))
  assert.equal(beginFull(p.root, 'ios-touch', fresh, next, process.pid).status, 'running')
})

test('失败/中断锁跨会话保留：旧证据、无关用例、换套件均拒绝，同输入仅允许一次相关复验', async t => {
  const p = project(t), hash = verificationHash(p.root, toolchain), proof = p.evidence()
  const attempt = beginFull(p.root, 'ios-touch', proof, hash, process.pid)
  finishFull(p.root, attempt, new Error('controlled failure'), [ui('test02RenameProduct')])
  assert.throws(() => beginFull(p.root, 'ios-touch', proof, hash, process.pid), /转局部/)
  await new Promise(resolve => setTimeout(resolve, 10))
  const newer = p.evidence('test07RestoreCandidates')
  assert.throws(() => beginFull(p.root, 'ios-touch', newer, hash, process.pid), /未覆盖失败/)
  assert.throws(() => beginFull(p.root, 'ios-smoke', newer, hash, process.pid), /先处理/)
  const repaired = p.evidence()
  const retry = beginFull(p.root, 'ios-touch', repaired, hash, process.pid)
  assert.equal(retry.status, 'running')
  assert.throws(() => beginFull(p.root, 'ios-touch', repaired, hash, process.pid), /再次失败\/中断/)
})

test('内部许可必须匹配调度器工作区锁与活动进程，直接 Shell 不能启动完整工作', t => {
  const p = project(t), hash = verificationHash(p.root, toolchain), proof = p.evidence()
  const attempt = beginFull(p.root, 'ios-touch', proof, hash, process.pid)
  assert.throws(() => requireActiveFull(p.root, 'ios-touch', attempt.run))
  p.write('.local/ios/tmp/ai-agent/ios-command.lock/owner.json', JSON.stringify({ pid: process.pid }))
  assert.equal(requireActiveFull(p.root, 'ios-touch', attempt.run).run, attempt.run)
  assert.throws(() => requireActiveFull(p.root, 'ios-smoke', attempt.run))
  finishFull(p.root, attempt)
  assert.throws(() => requireActiveFull(p.root, 'ios-touch', attempt.run))
})

test('正例观察器识别首个失败/超时与日志分块；通过不误停；未进入用例有界停止', t => {
  const p = project(t), attempt = { run: path.join(p.sessions, 'ios-full-watch') }
  fs.mkdirSync(attempt.run)
  const log = p.write('.local/ios/tmp/ai-agent/native-watch/test.log', '')
  const progress = path.join(attempt.run, 'progress.json')
  const step = () => fs.writeFileSync(progress, JSON.stringify({ log, startedAt: 100 }))
  step(); const watcher = observeFull(attempt, { now: () => 101 })
  fs.appendFileSync(log, "Test Case '-[DictionaryUITests.DictionaryTouchTests test02RenameProduct]' sta")
  watcher.poll(); fs.appendFileSync(log, "rted.\nTest Case '-[DictionaryUITests.DictionaryTouchTests test02RenameProduct]' failed (0.1 seconds).\n")
  assert.throws(() => watcher.poll(), /立即停止/); assert.deepEqual(watcher.failedCases, [ui('test02RenameProduct')])
  fs.writeFileSync(log, "Test Case '-[NativeTests.NativeSqliteTests testOfflineDictionaryPages]' exceeded execution time allowance of 1分钟.\n")
  assert.throws(() => observeFull(attempt).poll(), /立即停止/)
  fs.writeFileSync(log, "Test Case '-[NativeTests.NativeSqliteTests testOfflineDictionaryPages]' started.\nTest Case '-[NativeTests.NativeSqliteTests testOfflineDictionaryPages]' passed (1 seconds).\n")
  observeFull(attempt, { now: () => 999999 }).poll()
  fs.writeFileSync(log, 'Preparing automation session\n')
  assert.throws(() => observeFull(attempt, { now: () => 180101 }).poll(), /180 秒/)
})

test('真实 CLI 子进程首败即取消、执行退出清理、不继续后续步骤，并锁定原证据重跑', { timeout: 15_000 }, t => {
  const p = project(t)
  p.write('scripts/lib/ios-app-full.sh', `#!/bin/bash
set -e
trap 'echo cleaned > cleanup-receipt; exit 143' TERM INT
mkdir -p .local/ios/tmp/ai-agent/native-controlled
TEST_LOG="$PWD/.local/ios/tmp/ai-agent/native-controlled/test.log"
node scripts/lib/ios-verification.mjs step ios-touch "$MYBILL_FULL_ATTEMPT" "$TEST_LOG"
printf "Test Case '-[DictionaryUITests.DictionaryTouchTests test02RenameProduct]' failed (0.1 seconds).\\n" > "$TEST_LOG"
sleep 5
echo SHOULD_NOT_CONTINUE > continued
`)
  const proof = p.evidence(), run = p.run
  const missing = run(['ios-touch']); assert.equal(missing.status, 1); assert.match(missing.stderr, /--from/)
  const failed = run(['ios-touch', '--from', proof.run])
  assert.equal(failed.status, 1, failed.stderr); assert.match(failed.stderr, /立即停止/)
  assert.ok(fs.existsSync(path.join(p.root, 'cleanup-receipt')))
  assert.equal(fs.existsSync(path.join(p.root, 'continued')), false)
  assert.equal(fs.existsSync(path.join(p.sessions, 'ios-command.lock')), false)
  const again = run(['ios-touch', '--from', proof.run]); assert.equal(again.status, 1); assert.match(again.stderr, /转局部/)
  const state = JSON.parse(fs.readFileSync(path.join(p.sessions, 'ios-verification-state.json')))
  assert.equal(state.attempts['ios-touch'].status, 'failed')
  assert.deepEqual(state.attempts['ios-touch'].failedCases, [ui('test02RenameProduct')])
  const unrelated = run(['ios-touch', '--from', p.evidence('test07RestoreCandidates').run])
  assert.equal(unrelated.status, 1); assert.match(unrelated.stderr, /未覆盖失败/)
})

test('真实 CLI 放行当前局部证据并记录成功；关闭会话不能绕过无变化重复限制', t => {
  const p = project(t)
  p.write('scripts/lib/ios-app-full.sh', '#!/bin/bash\nnode scripts/lib/ios-verification.mjs permit ios-touch "$MYBILL_FULL_ATTEMPT"\nprintf FULL_ACCEPTED\n')
  const proof = p.evidence(), accepted = p.run(['ios-touch', '--from', proof.run])
  assert.equal(accepted.status, 0, accepted.stderr); assert.match(accepted.stdout, /FULL_ACCEPTED/)
  const file = path.join(p.session, 'test-context.json'), context = JSON.parse(fs.readFileSync(file)); context.state = 'closed'; fs.writeFileSync(file, JSON.stringify(context))
  const duplicate = p.run(['ios-touch', '--from', proof.run])
  assert.equal(duplicate.status, 1); assert.match(duplicate.stderr, /拒绝重复/)
  assert.equal(p.run(['ios-touch', '--from', proof.run, '--force']).status, 1)
})

test('真实 CLI 拒绝执行期间夹具变化产生的绿色，不为当前版本记录成功', t => {
  const p = project(t)
  p.write('scripts/lib/ios-app-full.sh', '#!/bin/bash\nprintf "# changed" >> scripts/fixtures/dictionary-touch.py\nprintf OLD_INPUT_FINISHED\n')
  const result = p.run(['ios-touch', '--from', p.evidence().run])
  assert.equal(result.status, 1); assert.match(result.stderr, /执行器变化/)
  const state = JSON.parse(fs.readFileSync(path.join(p.sessions, 'ios-verification-state.json')))
  assert.equal(state.attempts['ios-touch'].status, 'failed')
})
