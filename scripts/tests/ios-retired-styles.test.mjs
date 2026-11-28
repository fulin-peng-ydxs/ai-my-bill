import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { retiredStyleChanges } from '../lib/ios-retired-styles.mjs'
import { registry, selectSuites, requiredLocalFromPolicies, changeContents } from '../lib/ios-ci-plan.mjs'
import { requiredLocalSuites } from '../lib/ios-local-delivery.mjs'

const repository = new URL('../..', import.meta.url).pathname
const css = 'app/src/styles/tokens.css', keyboard = 'app/src/composables/useKeyboardViewport.ts'
const baseline = 'app/src/app/uiBaseline.json'
const before = '.admin-page{display:grid}@media (max-width:600px){.auth-card{color:red}}\n.app-shell:not(.admin-shell){display:grid}.active,.admin-search{color:blue}'
const after = '.app-shell.app-shell{display:grid}.active{color:blue}'
function fixture(t) {
  const root = fs.mkdtempSync(path.join(repository, '.local/ios/tmp/ai-agent/style-scope-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text) }
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
  write('app/src/App.vue', '<template><main class="app-shell active" /></template>')
  write(css, before); write(keyboard, "querySelector('.app-shell:not(.admin-shell)')")
  write(baseline, JSON.stringify({ styles: { original: 'fixed' }, styleAdaptations: {} }))
  write('config/ios-ci.json', fs.readFileSync(path.join(repository, 'config/ios-ci.json'), 'utf8'))
  git('add', '.'); git('commit', '-qm', 'fixture')
  const base = git('rev-parse', 'HEAD')
  const changes = new Map([[css, { before, after }], [keyboard, {
    before: "querySelector('.app-shell:not(.admin-shell)')", after: "querySelector('.app-shell')"
  }], [baseline, { before: fs.readFileSync(path.join(root, baseline), 'utf8'), after: JSON.stringify({ styles: { original: 'fixed' }, styleAdaptations: { removed: true } }) }]])
  return { root, git, write, base, changes, files: [...changes.keys()] }
}

test('退役纯删除只保留键盘交互，常规检查与双策略核验不减少；可信检出消费 head blobs', t => {
  const f = fixture(t), r = registry(repository)
  const names = selectSuites(r, 'change', f.files, { root: f.root, changes: f.changes, execution: 'local' }).map(x => x.name)
  assert.deepEqual(names.filter(n => !['secrets', 'workflow-quality', 'app-common', 'scripts', 'scripts-macos'].includes(n)), ['ui-ios-interaction'])
  assert.ok(names.includes('app-common')); assert.ok(names.includes('workflow-quality'))
  assert.deepEqual(requiredLocalFromPolicies(r, r, f.files, f.changes, f.root).map(x => x.name), ['ui-ios-interaction'])
  for (const [file, change] of f.changes) f.write(file, change.after)
  f.git('add', '.'); f.git('commit', '-qm', 'cleanup'); const head = f.git('rev-parse', 'HEAD')
  assert.equal(changeContents(f.root, f.files, f.base, head).get(css).after, after)
  f.git('checkout', '--detach', f.base)
  assert.deepEqual(requiredLocalSuites(f.root, f.base, head).map(x => x.name), ['ui-ios-interaction'])
  assert.ok(selectSuites(r, 'change', f.files, { changes: f.changes }).some(x => x.name === 'native-sqlite'))
})

for (const [name, mutate] of [
  ['有效声明', f => { f.changes.get(css).after = after.replace('blue', 'red') }],
  ['有效选择器', f => { f.changes.get(css).after = after.replace('.active', '.different') }],
  ['优先级', f => { f.changes.get(css).after = after.replace('.app-shell.app-shell', '.app-shell') }],
  ['新增旧规则', f => { f.changes.get(css).after += '.admin-new{color:red}' }],
  ['嵌套非必需分支', f => { f.changes.get(css).before += ':is(.active,.admin-new){color:red}' }],
  ['嵌套层注册', f => { f.changes.get(css).before += '.admin-page{@layer later{.active{color:red}}}' }],
  ['活跃消费者', f => f.write('app/src/App.vue', '<template><main class="admin-page" /></template>')],
  ['原基线变化', f => { f.changes.get(baseline).after = '{"styles":{}}' }],
  ['键盘行为变化', f => { f.changes.get(keyboard).after += ';update()' }],
  ['混合运行实现', f => { f.files.push('app/src/api/expenses.ts') }],
  ['缺失前文', f => { f.changes.get(css).before = null }],
  ['非法CSS', f => { f.changes.get(css).after += '{' }]
]) test('保守回退保留所有原专项：' + name, t => {
  const f = fixture(t); mutate(f)
  assert.equal(retiredStyleChanges(f.root, f.files, f.changes).size, 0)
  const suites = selectSuites(registry(repository), 'change', f.files, { root: f.root, changes: f.changes })
  assert.ok(suites.some(x => x.name === 'native-sqlite')); assert.ok(suites.some(x => x.name === 'ui-entry'))
})

test('媒体条件、声明顺序与未知at-rule不能借删除消失；focus合法分支可删除', t => {
  const f = fixture(t)
  for (const [a, b] of [
    ['@media (max-width:600px){.active{color:blue}}', '@media (max-width:601px){.active{color:blue}}'],
    ['.active{color:red;color:blue}', '.active{color:blue;color:red}'],
    ['@layer first;@font-face{font-family:x;src:url(x)}', '@layer first;'],
    ['.active:not(.admin-page){color:red}', '.active{color:red}']
  ]) {
    f.changes.set(css, { before: a, after: b })
    assert.equal(retiredStyleChanges(f.root, f.files, f.changes).size, 0)
  }
  f.changes.set(css, { before, after })
  const focus = 'app/src/styles/focus.css'; f.files.push(focus)
  f.changes.set(focus, { before: ':is(.global-search, .admin-search, .date-time-control):focus{outline:0}.page-scroll-region:focus,.data-table-scroll:focus{outline:none}', after: ':is(.global-search, .date-time-control):focus{outline:0}.page-scroll-region:focus{outline:none}' })
  assert.ok(retiredStyleChanges(f.root, f.files, f.changes).has(focus))
})

test('无关文档/普通测试和选测消费者自身不启动模拟器，不改变失败锁或原执行测量', t => {
  const r = registry(repository)
  const files = ['scripts/lib/ios-retired-styles.mjs', 'scripts/lib/ios-ci-plan.mjs', 'scripts/lib/ios-local-delivery.mjs', 'scripts/tests/ios-retired-styles.test.mjs', 'agent-works/testing/guide.md']
  assert.deepEqual(requiredLocalFromPolicies(r, r, files, new Map(), repository), [])
  assert.equal(retiredStyleChanges(repository, ['README.md'], new Map()).size, 0)
})

test('PR只读回执与可信发布使用同一锁定解析器准备，先准备再选测，不启动设备', () => {
  const workflow = fs.readFileSync(path.join(repository, '.github/workflows/offline-ios.yml'), 'utf8')
  const job = workflow.slice(workflow.indexOf('\n  local_evidence:'), workflow.indexOf('\n  result:'))
  const setup = job.indexOf('prepareTrustedParser(process.cwd())')
  assert.ok(setup > job.indexOf('actions/setup-node@v4'))
  assert.ok(setup < job.indexOf('run: node scripts/ios-evidence.mjs'))
  assert.doesNotMatch(job, /IOS_EVIDENCE_PUBLISH|simctl|xcodebuild/)
  const metadata = fs.readFileSync(path.join(repository, 'scripts/ios-evidence.mjs'), 'utf8')
  const trustedSetup = metadata.indexOf('if (publish) prepareTrustedParser(root)')
  assert.ok(trustedSetup >= 0 && trustedSetup < metadata.indexOf('const required = requiredLocalSuites'))
})
