import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('固定安全工具下载校验、缓存、工作流和 Gitleaks 范围及精确例外拒绝', () => {
  const run = spawnSync('python3', ['-B', new URL('./ios-security-cases.py', import.meta.url).pathname], {
    encoding: 'utf8', timeout: 30000
  })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stderr, /Ran 12 tests/)
})
