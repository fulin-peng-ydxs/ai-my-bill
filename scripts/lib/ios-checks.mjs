import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { assertScriptReport } from './ios-test-reports.mjs'

/** App 工具测试同源自动发现；新增普通用例不再维护调试/完整入口两份文件清单。 */
export function scriptTestFiles(root) {
  const files = fs
    .readdirSync(path.join(root, 'scripts/tests'))
    .filter((name) => /^ios-.*\.test\.mjs$/.test(name))
    .sort()
    .map((name) => 'scripts/tests/' + name)
  if (
    !files.length ||
    files.some(
      (file) =>
        !fs.lstatSync(path.join(root, file)).isFile() ||
        fs.realpathSync(path.join(root, file)) !== path.join(root, file)
    )
  )
    throw new Error('工具测试为空或含链接/非普通文件。')
  return files
}

export const checkNames = [
  'app-tests',
  'app-build',
  'probe-build',
  'script-tests',
  'resources',
  'native-build'
]
/** 白名单命令与证据层次同源，禁止将任意 shell 字符串当成局部通过证据。 */
export function checkDefinition(root, run, name, options = {}) {
  if (!checkNames.includes(name)) throw new Error('未知局部检查；使用 debug list 查看。')
  if (name !== 'native-build' && (options.scheme || options.configuration))
    throw new Error('只有 native-build 支持工程目标。')
  if (name !== 'resources' && options.target) throw new Error('只有 resources 支持 --target。')
  const log = path.join(run, 'check.log')
  if (name === 'app-tests') {
    const report = path.join(run, 'vitest.json')
    const args = [
      '--prefix',
      'app',
      'test',
      '--',
      '--bail=1',
      '--reporter=json',
      '--outputFile=' + report
    ]
    if (options.file) {
      const absolute = path.resolve(root, 'app', options.file)
      if (
        !absolute.startsWith(path.join(root, 'app/src') + path.sep) ||
        !absolute.endsWith('.spec.ts') ||
        fs.realpathSync(absolute) !== absolute
      )
        throw new Error('局部测试文件必须是 app/src 下的真实 .spec.ts。')
      args.push(options.file)
    }
    if (options.name) args.push('--testNamePattern=' + options.name)
    return { program: 'npm', args, stage: 'check', coverage: ['check/app-tests'], log, report }
  }
  if (options.file || options.name) throw new Error('只有 app-tests 支持 --file / --name。')
  if (name === 'script-tests')
    return {
      program: process.execPath,
      args: ['scripts/lib/ios-checks.mjs', 'run-script-tests'],
      stage: 'check',
      coverage: ['check/script-tests'],
      log
    }
  if (name === 'resources') {
    const target = options.target ?? 'source'
    const paths = {
      source: undefined,
      simulator: '.local/ios/DerivedData/Build/Products/Release-iphonesimulator/App.app',
      device: '.local/ios/DerivedData/Build/Products/Release-iphoneos/App.app'
    }
    if (!Object.hasOwn(paths, target))
      throw new Error('资源目标只允许 source / simulator / device。')
    return {
      program: process.execPath,
      args: ['scripts/verify-ios-resources.mjs', ...(paths[target] ? [paths[target]] : [])],
      stage: 'check',
      coverage: ['check/resources/' + target],
      log
    }
  }
  if (options.target) throw new Error('只有 resources 支持 --target。')
  if (name === 'native-build') {
    const scheme = options.scheme ?? 'App',
      configuration = options.configuration ?? (scheme === 'App' ? 'Debug' : 'Release')
    if (
      !(scheme === 'App' && configuration === 'Debug') &&
      !(scheme === 'DictionaryTouch' && configuration === 'Release')
    )
      throw new Error('仅允许 App/Debug 或 DictionaryTouch/Release 测试构建。')
    return {
      program: 'xcodebuild',
      args: [
        'build-for-testing',
        '-project',
        'app/ios/App/App.xcodeproj',
        '-scheme',
        scheme,
        '-configuration',
        configuration,
        '-destination',
        'generic/platform=iOS Simulator',
        '-derivedDataPath',
        '.local/ios/DerivedData',
        '-clonedSourcePackagesDirPath',
        '.local/ios/SourcePackages',
        '-disableAutomaticPackageResolution',
        'CODE_SIGNING_ALLOWED=NO'
      ],
      stage: 'build',
      native: true,
      coverage: [`native-build/${scheme}/${configuration}`],
      log
    }
  }
  if (options.scheme || options.configuration)
    throw new Error('只有 native-build 支持 --scheme / --configuration。')
  return {
    program: 'npm',
    args: ['--prefix', 'app', 'run', name === 'app-build' ? 'native:sync' : 'probe:bundle'],
    stage: 'build',
    coverage: ['check/' + name],
    log
  }
}

// 完整 Shell 的叶子执行器仅运行同一工具测试集合，不另建验收调度或绕过原生证据锁。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== 'run-script-tests') {
    console.error('仅支持 run-script-tests。')
    process.exitCode = 1
  } else {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    // 独立 runner 不继承上层 node:test 的内部上下文，否则 Node 会静默跳过嵌套执行。
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...scriptTestFiles(root)], {
      cwd: root,
      env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    process.exitCode = result.error ? 1 : result.status ?? 1
    if (result.error) console.error(result.error.message)
    if (!result.error && result.status === 0) {
      try {
        assertScriptReport(root, result.stdout, process.platform)
      } catch (error) {
        console.error(error.message)
        process.exitCode = 1
      }
    }
  }
}
