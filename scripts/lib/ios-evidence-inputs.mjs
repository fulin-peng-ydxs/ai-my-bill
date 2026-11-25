import { release } from 'node:os'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { contentHash, generated } from './ios-cache.mjs'
import { RUNTIME } from './ios-debug.mjs'
import { controlInputs } from './ios-verification.mjs'

/** Execution inputs deliberately omit documentation and Git commit metadata. Missing inputs are hashed too. */
export function measurementInputs(root) {
  // Python fixture imports generate bytecode on a clean runner. These outputs are not source inputs.
  const excluded = relative => generated(relative) || relative.split(path.sep).includes('__pycache__') || /\.py[co]$/.test(relative)
  const inputs = [...new Set([...controlInputs,
    'app/src', 'app/index.html', 'app/public', 'app/native-tests', 'app/test-support', 'app/ios/App',
    'app/package.json', 'app/package-lock.json', 'app/capacitor.config.ts', 'app/vite.config.ts',
    'app/vitest.config.ts', 'app/tsconfig.json', 'app/tsconfig.tools.json',
    'scripts/lib', 'scripts/tests', 'scripts/fixtures', 'scripts/ios-app.mjs', 'scripts/ios-app.sh',
    'scripts/ios-ci.mjs', 'scripts/ios-ci.sh', 'scripts/toolchain.sh', 'scripts/normalize-capacitor-spm.mjs',
    'scripts/verify-ios-resources.mjs', 'scripts/ios-storage-policy.mjs', 'config/ios-ci.json',
    'config/ios-security-exceptions.json', 'package.json', '.nvmrc'
  ])].sort()
  const permissions = new Map()
  const visit = relative => {
    if (excluded(relative) || !fs.existsSync(path.join(root, relative))) return
    const stat = fs.lstatSync(path.join(root, relative))
    if (stat.isSymbolicLink()) throw new Error('测量输入不能使用符号链接：' + relative)
    if (stat.isDirectory()) for (const name of fs.readdirSync(path.join(root, relative)).sort()) visit(path.join(relative, name))
    else if (stat.isFile()) permissions.set(relative, stat.mode & 0o111)
  }
  inputs.forEach(visit)
  return createHash('sha256').update(contentHash(root, inputs, excluded) + '\0' + JSON.stringify([...permissions].sort())).digest('hex')
}

/** A local measurement is reusable only on the same host/toolchain context, never a remote report. */
export function measurementHost() {
  return createHash('sha256').update(JSON.stringify([process.version, process.platform, process.arch, release()])).digest('hex')
}

/** Read versions only, with one bounded budget; checking a receipt never boots a simulator. */
export function nativeEnvironment() {
  if (process.platform !== 'darwin') throw new Error('原生证据只能在原 macOS 工具链核验。')
  const env = { ...process.env }, until = Date.now() + 30000
  const run = (program, args) => {
    const remaining = until - Date.now()
    if (remaining <= 0) throw new Error('原生证据工具链核验超时。')
    return execFileSync(program, args, { env, encoding: 'utf8', timeout: remaining, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  }
  if (!env.DEVELOPER_DIR && run('xcode-select', ['-p']).trim() === '/Library/Developer/CommandLineTools' && fs.existsSync('/Applications/Xcode.app'))
    env.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer'
  const runtime = JSON.parse(run('xcrun', ['simctl', 'list', 'runtimes', '--json'])).runtimes.find(r => r.identifier === RUNTIME && r.isAvailable)
  const sdk = run('xcrun', ['--sdk', 'iphoneos', '--show-sdk-version']).trim()
  const xcode = run('xcodebuild', ['-version'])
  if (!runtime || !/^27\./.test(sdk) || !/^Xcode 27\./.test(xcode)) throw new Error('原生证据工具链不可用。')
  return { sdk, xcode, node: process.version, arch: process.arch, host: release(), runtime: runtime.buildversion }
}
