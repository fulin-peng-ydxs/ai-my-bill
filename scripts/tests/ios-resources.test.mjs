import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('随包资源门禁接受离线入口，拒绝远程地址和混入的原生测试包', async () => {
  const tempRoot = resolve(root, '.local/ios/tmp/ai-agent')
  await mkdir(tempRoot, { recursive: true })
  const fixture = await mkdtemp(resolve(tempRoot, 'resource-gate-'))
  const config = {
    appId: 'com.mybill.offline', ios: { webContentsDebuggingEnabled: false },
    plugins: { CapacitorSQLite: { iosDatabaseLocation: 'Library/OfflineLedger' } },
  }
  const run = () => spawnSync(process.execPath, [resolve(root, 'scripts/verify-ios-resources.mjs'), fixture], { encoding: 'utf8' })
  try {
    await mkdir(resolve(fixture, 'public'))
    const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\'">'
    await writeFile(resolve(fixture, 'public/index.html'), html)
    await writeFile(resolve(fixture, 'capacitor.config.json'), JSON.stringify(config))
    assert.equal(run().status, 0)
    await rm(resolve(fixture, 'public/index.html'))
    const missingEntry = run()
    assert.notEqual(missingEntry.status, 0)
    assert.match(missingEntry.stderr, /ENOENT/)
    await writeFile(resolve(fixture, 'public/index.html'), '<!-- connect-src \'self\' -->')
    const missingPolicy = run()
    assert.notEqual(missingPolicy.status, 0)
    assert.match(missingPolicy.stderr, /入口缺少有效的离线 CSP/)
    await writeFile(resolve(fixture, 'public/index.html'), html + '<script src="https://example.invalid/runtime.js"></script>')
    const remoteAsset = run()
    assert.notEqual(remoteAsset.status, 0)
    assert.match(remoteAsset.stderr, /HTML 依赖远程资源/)
    await writeFile(resolve(fixture, 'public/index.html'), html)
    await writeFile(resolve(fixture, 'capacitor.config.json'), JSON.stringify({ ...config, server: { url: 'https://example.invalid' } }))
    const remote = run()
    assert.notEqual(remote.status, 0)
    assert.match(remote.stderr, /不允许远程 server/)
    await writeFile(resolve(fixture, 'capacitor.config.json'), JSON.stringify(config))
    await writeFile(resolve(fixture, 'public/ledger.js'), "indexedDB.open('ledger'); localStorage.setItem('ledger','[]')")
    const webStorage = run()
    assert.notEqual(webStorage.status, 0)
    assert.match(webStorage.stderr, /禁止的 Web 存储/)
    await rm(resolve(fixture, 'public/ledger.js'))
    await writeFile(resolve(fixture, 'public/ledger.mjs'), "globalThis['indexedDB'].open('ledger')")
    assert.notEqual(run().status, 0)
    await rm(resolve(fixture, 'public/ledger.mjs'))
    await mkdir(resolve(fixture, 'PlugIns/NativeTests.xctest'), { recursive: true })
    const probe = run()
    assert.notEqual(probe.status, 0)
    assert.match(probe.stderr, /生产资源混入原生探针/)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('JS 解析器拒绝直接/别名/括号/转义访问的 Web 存储，保留合法文本', async () => {
  const { assertNoWebStorage } = await import('../ios-storage-policy.mjs')
  for (const source of [
    "indexedDB.open('ledger')", "window.localStorage.setItem('ledger','[]')",
    "const db = globalThis['indexedDB']; db.open('ledger')", "window['local'+'Storage'].getItem('x')",
    "const { sessionStorage: store } = window", "window['indexed\\u0044B'].open('ledger')",
    "openDatabase('ledger')", 'WebAssembly.instantiate(data)',
  ]) assert.throws(() => assertNoWebStorage(source, 'fixture.js'), /禁止的 Web 存储/)
  assert.doesNotThrow(() => assertNoWebStorage("// indexedDB\nconst message='不能使用 localStorage'; nativeLedger.open()", 'allowed.js'))
})
