import fs from 'node:fs'
import path from 'node:path'

export const checkNames = ['app-tests', 'app-build', 'probe-build', 'script-tests', 'resources', 'native-build']
/** 白名单命令与证据层次同源，禁止将任意 shell 字符串当成局部通过证据。 */
export function checkDefinition(root, run, name, options = {}) {
  if (!checkNames.includes(name)) throw new Error('未知局部检查；使用 debug list 查看。')
  if (name !== 'native-build' && (options.scheme || options.configuration)) throw new Error('只有 native-build 支持工程目标。')
  if (name !== 'resources' && options.target) throw new Error('只有 resources 支持 --target。')
  const log = path.join(run, 'check.log')
  if (name === 'app-tests') {
    const report = path.join(run, 'vitest.json')
    const args = ['--prefix', 'app', 'test', '--', '--bail=1', '--reporter=json', '--outputFile=' + report]
    if (options.file) {
      const absolute = path.resolve(root, 'app', options.file)
      if (!absolute.startsWith(path.join(root, 'app/src') + path.sep) || !absolute.endsWith('.spec.ts') || fs.realpathSync(absolute) !== absolute) throw new Error('局部测试文件必须是 app/src 下的真实 .spec.ts。')
      args.push(options.file)
    }
    if (options.name) args.push('--testNamePattern=' + options.name)
    return { program: 'npm', args, stage: 'check', coverage: ['check/app-tests'], log, report }
  }
  if (options.file || options.name) throw new Error('只有 app-tests 支持 --file / --name。')
  if (name === 'script-tests') return { program: process.execPath, args: ['--test', 'scripts/tests/ios-debug.test.mjs', 'scripts/tests/ios-verification.test.mjs', 'scripts/tests/ios-resources.test.mjs'], stage: 'check', coverage: ['check/script-tests'], log }
  if (name === 'resources') {
    const target = options.target ?? 'source'
    const paths = { source: undefined, simulator: '.local/ios/DerivedData/Build/Products/Release-iphonesimulator/App.app', device: '.local/ios/DerivedData/Build/Products/Release-iphoneos/App.app' }
    if (!Object.hasOwn(paths, target)) throw new Error('资源目标只允许 source / simulator / device。')
    return { program: process.execPath, args: ['scripts/verify-ios-resources.mjs', ...(paths[target] ? [paths[target]] : [])], stage: 'check', coverage: ['check/resources/' + target], log }
  }
  if (options.target) throw new Error('只有 resources 支持 --target。')
  if (name === 'native-build') {
    const scheme = options.scheme ?? 'App', configuration = options.configuration ?? (scheme === 'App' ? 'Debug' : 'Release')
    if (!(scheme === 'App' && configuration === 'Debug') && !(scheme === 'DictionaryTouch' && configuration === 'Release')) throw new Error('仅允许 App/Debug 或 DictionaryTouch/Release 测试构建。')
    return { program: 'xcodebuild', args: ['build-for-testing', '-project', 'app/ios/App/App.xcodeproj', '-scheme', scheme,
      '-configuration', configuration, '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', '.local/ios/DerivedData',
      '-clonedSourcePackagesDirPath', '.local/ios/SourcePackages', '-disableAutomaticPackageResolution', 'CODE_SIGNING_ALLOWED=NO'],
    stage: 'build', native: true, coverage: [`native-build/${scheme}/${configuration}`], log }
  }
  if (options.scheme || options.configuration) throw new Error('只有 native-build 支持 --scheme / --configuration。')
  return { program: 'npm', args: ['--prefix', 'app', 'run', name === 'app-build' ? 'native:sync' : 'probe:bundle'],
    stage: 'build', coverage: ['check/' + name], log }
}
