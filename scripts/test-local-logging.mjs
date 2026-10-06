import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'my-bill-log-test-'))
const env = { ...process.env, MY_BILL_LOCAL_LOG_ROOT: root, MY_BILL_LOCAL_LOG_FILE_MB: '1', MY_BILL_LOCAL_LOG_TOTAL_MB: '2' }
try {
  const result = spawnSync(process.execPath, ['scripts/lib/local-log-runner.mjs', 'frontend', process.execPath, '-e',
    'process.stdout.write("x".repeat(3*1024*1024));process.stderr.write("failure-marker");process.exitCode=17'], { env, maxBuffer: 5*1024*1024 })
  assert.equal(result.status, 17)
  const files = readdirSync(join(root, 'frontend')).map(name => join(root, 'frontend', name))
  assert.ok(files.reduce((sum, file) => sum + statSync(file).size, 0) <= 2*1024*1024)
  assert.ok(files.some(file => readFileSync(file, 'utf8').includes('failure-marker')))
  assert.ok(files.every(file => (statSync(file).mode & 0o077) === 0))
  const processUnderTest = spawn(process.execPath, ['scripts/lib/local-log-runner.mjs', 'backend', process.execPath, '-e',
    'require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});console.log("ready");setInterval(()=>{},1000)'], { env })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { processUnderTest.kill('SIGKILL'); reject(new Error('Signal cleanup timeout')) }, 9000)
    processUnderTest.stdout.once('data', () => setTimeout(() => processUnderTest.kill('SIGTERM'), 100))
    processUnderTest.on('close', code => { clearTimeout(timer); assert.equal(code, 1); resolve() })
  })
  const invalid = spawnSync(process.execPath, ['scripts/lib/local-log-runner.mjs', 'frontend', 'true'], { env: { ...env, MY_BILL_LOCAL_LOG_DAYS: '0' } })
  assert.notEqual(invalid.status, 0)
  console.log('PASS: log size bounds, permissions, exit status and process-group cleanup')
} finally { rmSync(root, { recursive: true, force: true }) }
