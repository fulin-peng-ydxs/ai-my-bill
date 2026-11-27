import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertRetiredInputs } from '../lib/ios-retirement.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(root, '.local/ios/tmp/ai-agent/retirement-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, stdio: 'pipe' })
  git('init', '-q')
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), value) }
  write('.gitignore', '.local/\n')
  write('package.json', JSON.stringify({ scripts: { check: 'bash scripts/ios-app.sh common' } }))
  return { dir, git, write }
}
test('T16 退役门禁覆盖当前工程，忽略的旧账本与凭据不参与或被清理', t => {
  assert.equal(assertRetiredInputs(root).status, 'passed')
  const f = fixture(t)
  f.write('server/.local/web/ledger.db', 'private synthetic data')
  f.write('.local/web/credential', 'synthetic credential')
  assert.equal(assertRetiredInputs(f.dir).status, 'passed')
  assert.equal(fs.readFileSync(path.join(f.dir, 'server/.local/web/ledger.db'), 'utf8'), 'private synthetic data')
  f.git('add', '-f', 'server/.local/web/ledger.db')
  assert.throws(() => assertRetiredInputs(f.dir), /退役运行材料/)
})
test('T16 拒绝旧运行目录、根命令和 App 旧网络契约复活，合法离线契约保持可用', t => {
  const f = fixture(t)
  for (const file of ['web/src/main.ts', 'server/pom.xml', 'deploy/compose.yaml', 'contracts/openapi.yaml', 'pom.xml']) {
    f.write(file, 'old input'); assert.throws(() => assertRetiredInputs(f.dir), /退役运行材料/); fs.unlinkSync(path.join(f.dir, file))
  }
  f.write('package.json', JSON.stringify({ scripts: { check: 'docker compose up' } }))
  assert.throws(() => assertRetiredInputs(f.dir), /根命令/)
  f.write('package.json', JSON.stringify({ scripts: { check: 'bash scripts/ios-app.sh common' } }))
  for (const text of ["import type { components } from './generated/schema'", "apiRequest('/api/v1/expenses')", 'navigator.serviceWorker.register(url)']) {
    f.write('app/src/api/expenses.ts', text); assert.throws(() => assertRetiredInputs(f.dir), /旧网络契约/)
  }
  f.write('scripts/toolchain.sh', 'resolve_java() { return 0; }')
  assert.throws(() => assertRetiredInputs(f.dir), /旧 Java/)
  f.write('scripts/toolchain.sh', 'resolve_node() { return 0; }')
  f.write('app/src/api/expenses.ts', "import type { LedgerContracts } from '../domain/ledgerContracts'\nlocalService.save()")
  assert.equal(assertRetiredInputs(f.dir).status, 'passed')
})
