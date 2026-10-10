import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { readDevEnvironment } from './dev-environment.mjs'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
function fixture(t, source) {
  const root = mkdtempSync(join(tmpdir(), 'my-bill-dev-env-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.local'))
  if (source !== undefined) writeFileSync(join(root, '.local/dev.env'), source)
  return root
}

test('缺失文件不创建，已有 shell 值（含空值）优先，配置不展开命令', t => {
  const root = fixture(t)
  assert.deepEqual(readDevEnvironment(root, {}), {})
  assert.equal(existsSync(join(root, '.local/dev.env')), false)
  writeFileSync(join(root, '.local/dev.env'), '# comment\r\nMY_BILL_WEB_HOST=0.0.0.0\r\nMY_BILL_SERVER_PORT=18080\nMY_BILL_DB_APP_PASSWORD="$(touch never-run) $HOME # value"\nJAVA_HOME="/test jdk"\n')
  assert.deepEqual(readDevEnvironment(root, { MY_BILL_WEB_HOST: '', MY_BILL_SERVER_PORT: '28080' }), {
    MY_BILL_DB_APP_PASSWORD: '$(touch never-run) $HOME # value', JAVA_HOME: '/test jdk',
  })
  assert.equal(existsSync(join(root, 'never-run')), false)
})

test('拒绝错误格式、重复键及非项目变量，错误不泄露配置值', t => {
  const root = fixture(t)
  for (const source of ['MY_BILL_TOKEN="sensitive', 'invalid sensitive', 'PATH=sensitive', 'MY_BILL_TOKEN=a\nMY_BILL_TOKEN=sensitive', 'MY_BILL_TOKEN=sensitive\0', `MY_BILL_TOKEN=${'s'.repeat(65536)}`]) {
    writeFileSync(join(root, '.local/dev.env'), source)
    assert.throws(() => readDevEnvironment(root, {}), error => !error.message.includes('sensitive'))
  }
})

test('Bash 桥接保持引号、换行和命令字面值，解析失败不导出部分配置', t => {
  const root = fixture(t, 'MY_BILL_TOKEN="line\\nquote\' $(touch never-run)"\n')
  mkdirSync(join(root, 'scripts/lib'), { recursive: true })
  for (const name of ['dev-environment.mjs', 'dev-environment.sh']) copyFileSync(join(projectRoot, 'scripts/lib', name), join(root, 'scripts/lib', name))
  const code = 'set -euo pipefail; PROJECT_ROOT="$1"; resolve_node() { :; }; source "$PROJECT_ROOT/scripts/lib/dev-environment.sh"; load_dev_environment; node -e \'process.stdout.write(JSON.stringify(process.env.MY_BILL_TOKEN))\''
  const result = spawnSync('bash', ['-c', code, 'test', root], { encoding: 'utf8', cwd: root })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout), "line\nquote' $(touch never-run)")
  assert.equal(existsSync(join(root, 'never-run')), false)
  writeFileSync(join(root, '.local/dev.env'), 'MY_BILL_TOKEN=first\nPATH=sensitive\n')
  const failure = spawnSync('bash', ['-c', code, 'test', root], { encoding: 'utf8' })
  assert.notEqual(failure.status, 0)
  assert.equal(failure.stdout, '')
  assert.ok(!failure.stderr.includes('sensitive'))
})

// 在复制的真实入口中替换服务进程为探针，证明装配顺序而不启动/修改任何数据库。
test('总启动、数据库和后端独立入口在消费者之前加载同一配置', t => {
  const root = fixture(t, 'MY_BILL_SERVER_PORT=18080\nMY_BILL_DB_NAME=fixture_only\nJAVA_HOME=/fixture-jdk\n')
  mkdirSync(join(root, 'scripts/lib'), { recursive: true })
  for (const name of ['dev-environment.mjs', 'dev-environment.sh', 'local-log-runner.mjs']) copyFileSync(join(projectRoot, 'scripts/lib', name), join(root, 'scripts/lib', name))
  for (const name of ['dev.sh', 'dev-db.sh', 'run-backend.sh']) copyFileSync(join(projectRoot, 'scripts', name), join(root, 'scripts', name))
  writeFileSync(join(root, 'scripts/toolchain.sh'), 'resolve_node() { :; }\nresolve_java() { :; }\nresolve_toolchain() { :; }\n')
  const probe = `exec "${process.execPath}" -e 'console.log(JSON.stringify({port:process.env.MY_BILL_SERVER_PORT,db:process.env.MY_BILL_DB_NAME,jdk:process.env.JAVA_HOME}))'`
  writeFileSync(join(root, 'scripts/lib/dev-database.sh'), `configure_dev_database() { ${probe}; }\n`)
  writeFileSync(join(root, 'mvnw'), `#!/usr/bin/env bash\n${probe}\n`, { mode: 0o700 })
  const environment = { ...process.env }
  for (const name of ['MY_BILL_SERVER_PORT', 'MY_BILL_DB_NAME', 'JAVA_HOME', 'MY_BILL_LOCAL_LOG_ROOT']) delete environment[name]
  for (const entry of ['dev.sh', 'dev-db.sh', 'run-backend.sh']) {
    const result = spawnSync('bash', [join(root, 'scripts', entry)], { encoding: 'utf8', env: environment, cwd: root, timeout: 10000 })
    assert.equal(result.status, 0, `${entry}: ${result.stderr}`)
    const output = result.stdout.split('\n').find(line => line.startsWith('{'))
    assert.deepEqual(JSON.parse(output), { port: '18080', db: 'fixture_only', jdk: '/fixture-jdk' })
  }
})
