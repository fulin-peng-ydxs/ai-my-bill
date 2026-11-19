import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { hashPaths } from './ios-debug.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const generated = p => p.includes('/CapApp-SPM') || p.includes('/App/public') ||
  p.includes('/xcuserdata') || p.endsWith('/capacitor.config.json') || p.endsWith('/config.xml') ||
  path.basename(p) === '.DS_Store'
const specs = p => p.endsWith('.spec.ts') || p.includes('/__tests__/')

/** 缺失也参与摘要，新增/删除可选输入不能悄悄命中旧缓存。 */
export function contentHash(root, inputs, exclude = () => false) {
  return digest(inputs.map(p => fs.existsSync(path.join(root, p))
    ? p + '\0' + hashPaths(root, [p], exclude) : p + '\0missing').join('\0'))
}

export const assetOutputs = ['app/dist', 'app/ios/App/App/public',
  'app/ios/App/App/capacitor.config.json', 'app/ios/App/App/config.xml', 'app/ios/App/CapApp-SPM']
const dependencies = ['app/package.json', 'app/package-lock.json']
const shared = ['app/src', 'app/native-tests', 'app/test-support', ...dependencies]

/** 构建依赖与验收输入分离：改定位器/夹具脚本不重打前端，仍使执行证据失效。 */
export function layerInputs(root, toolchain, selected, outputs = {}) {
  const types = contentHash(root, [...shared, 'app/tsconfig.json', 'app/tsconfig.tools.json',
    'app/vite.config.ts', 'app/vitest.config.ts', 'app/capacitor.config.ts'])
  const assets = contentHash(root, ['app/src', 'app/index.html', 'app/public', 'app/tsconfig.json', ...dependencies,
    'app/vite.config.ts', 'app/capacitor.config.ts', 'scripts/normalize-capacitor-spm.mjs'], specs)
  const probe = contentHash(root, [...shared, 'app/tsconfig.json'], specs)
  const native = contentHash(root, ['app/ios/App',
    ...(selected.scheme === 'DictionaryTouch' ? ['app/test-support/reportTouchFixture.json'] : [])], generated)
  return {
    types: digest(types + '\0' + toolchain),
    assets: digest(assets + '\0' + toolchain),
    probe: digest(probe + '\0' + toolchain),
    native: digest([native, outputs.assets, selected.scheme === 'App' ? outputs.probe : '',
      toolchain, selected.scheme, selected.configuration].join('\0'))
  }
}

/** 只复用成功且输入、产物均一致的层；失败先撤销该层，其他有效层继续保留。 */
export async function cachedLayer({ root, directory, name, input, outputs, build, force = false }) {
  const file = path.join(directory, `layer-${name}.json`)
  let receipt
  if (fs.existsSync(file)) {
    try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* 损坏回执按 miss 重建。 */ }
  }
  const outputHash = () => contentHash(root, outputs)
  const complete = () => outputs.every(p => fs.existsSync(path.join(root, p)))
  const before = input()
  if (!force && receipt?.schema === 1 && receipt.input === before && complete() && receipt.output === outputHash())
    return { ...receipt, hit: true }
  fs.rmSync(file, { force: true })
  await build()
  if (input() !== before) throw new Error(`${name} 构建期间输入变化，拒绝缓存混合版本。`)
  if (!complete()) throw new Error(`${name} 构建产物不完整。`)
  receipt = { schema: 1, input: before, output: outputHash() }
  fs.writeFileSync(file, JSON.stringify(receipt), { mode: 0o600 })
  return { ...receipt, hit: false }
}

/** App 与 runner 分别核验；测试代码变化通常只需更新 runner。 */
export function installationMatches(built, installed) {
  return Boolean(installed && fs.existsSync(installed) && hashPaths(built, ['.']) === hashPaths(installed, ['.']))
}

/** 已登记但损坏/跨会话的安装不能降级为冷安装，否则会绕过拒绝并清除现有合成数据。 */
export function readInstallationLease(session) {
  const file = path.join(session.directory, 'ui-install.json')
  let stat
  try {
    stat = fs.lstatSync(file)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > 4096)
    throw new Error('安装回执类型、权限或大小不合法，拒绝重装或重置。')
  const lease = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!lease || Object.keys(lease).sort().join(',') !== 'appHash,appId,container,runId,simulatorId' ||
    ['runId', 'simulatorId', 'appId'].some(k => lease[k] !== session.context[k]) ||
    !/^[a-f0-9]{64}$/.test(lease.appHash) || typeof lease.container !== 'string' || !path.isAbsolute(lease.container))
    throw new Error('安装回执与本会话不匹配，拒绝重装或重置。')
  return lease
}
