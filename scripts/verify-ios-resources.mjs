import assert from 'node:assert/strict'
import { assertNoWebStorage } from './ios-storage-policy.mjs'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const resourceRoot = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'app/ios/App/App')
const config = JSON.parse(await readFile(resolve(resourceRoot, 'capacitor.config.json'), 'utf8'))
assert.equal(config.appId, 'com.mybill.offline')
assert.equal(config.server, undefined, '验收资源不允许远程 server 配置')
assert.equal(config.ios?.webContentsDebuggingEnabled, false)
assert.equal(config.plugins?.CapacitorSQLite?.iosDatabaseLocation, 'Library/OfflineLedger')
// 不能让只有配置、没有页面的空包通过；实际呈现另由原生测试验证。
await readFile(resolve(resourceRoot, 'public/index.html'), 'utf8')

function assertOfflinePolicy(html) {
  const policyMeta = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .find((tag) => /\bhttp-equiv\s*=\s*(["'])Content-Security-Policy\1/i.test(tag))
  const policy = policyMeta?.match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2]
  const directives = new Map((policy ?? '').split(';').map((part) => {
    const [key, ...values] = part.trim().split(/\s+/)
    return [key, values.join(' ')]
  }))
  assert.equal(directives.get('connect-src'), "'self'", '入口缺少有效的离线 CSP 连接约束')
}

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    assert(!entry.name.includes('sqlite-probe') && !entry.name.endsWith('.xctest'), '生产资源混入原生探针')
    if (entry.isDirectory()) await inspect(path)
    else if (/\.(?:html|[cm]?js|css|json)$/.test(entry.name)) {
      const contents = await readFile(path, 'utf8')
      assert(!/MyBillNativeProbe|probe_[a-z_]|jeep-sqlite/.test(contents), '生产资源包含测试写入或 Web 数据库')
      if (/\.[cm]?js$/.test(entry.name)) assertNoWebStorage(contents, path)
      // 静态必要资源不得来自网络；实际加载同时由原生测试核对。
      if (entry.name.endsWith('.html')) {
        assert(!/(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(contents), 'HTML 依赖远程资源')
        assertOfflinePolicy(contents)
        for (const match of contents.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
          if (match[1].trim()) assertNoWebStorage(match[1], path + '.inline.js')
        }
      }
    }
  }
}
await inspect(resourceRoot)
console.log('iOS 随包资源静态检查通过：远程入口、探针及已知 Web 存储/WASM 访问禁用；实际存储由原生测试验证。')
