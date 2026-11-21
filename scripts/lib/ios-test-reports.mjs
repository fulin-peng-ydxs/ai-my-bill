import fs from 'node:fs'
import path from 'node:path'

/** 只允许登记的 Linux 平台缺口；TODO 和未说明的跳过不能充当成功证据。 */
export function scriptSkipPolicy(registry) {
  const policy = registry.scriptSkips
  if (
    !policy ||
    Object.keys(policy).some((platform) => platform !== 'linux') ||
    !Array.isArray(policy.linux) ||
    new Set(policy.linux).size !== policy.linux.length ||
    policy.linux.some((name) => typeof name !== 'string' || !name.trim() || /[\r\n]/.test(name))
  )
    throw new Error('脚本平台跳过登记无效。')
  return policy
}

/** 消费固定 TAP 报告的计数及逐项 SKIP，不凭 exit=0 或一条通过记录放行。 */
export function assertScriptReport(root, log, platform) {
  const metric = (name) => {
    const matches = [...log.matchAll(new RegExp('^# ' + name + ' (\\d+)\\s*$', 'gm'))]
    return matches.length === 1 ? Number(matches[0][1]) : NaN
  }
  const tests = metric('tests'),
    passed = metric('pass'),
    skipped = metric('skipped')
  if (
    !(tests > 0) ||
    !(passed > 0) ||
    metric('fail') !== 0 ||
    metric('cancelled') !== 0 ||
    metric('todo') !== 0 ||
    !(skipped >= 0) ||
    passed + skipped !== tests
  )
    throw new Error('脚本回归为空、失败、取消、TODO 或计数不完整。')
  const policy = scriptSkipPolicy(JSON.parse(fs.readFileSync(path.join(root, 'config/ios-ci.json'))))
  const allowed = policy[platform] ?? []
  const names = [...log.matchAll(/^\s*ok \d+ - (.+?) # SKIP(?: [^\r\n]*)?$/gm)].map((match) => match[1])
  if (
    names.length !== skipped ||
    new Set(names).size !== names.length ||
    names.some((name) => !allowed.includes(name))
  )
    throw new Error('脚本回归存在未登记、重复或错误平台的跳过。')
}

/** 与现有完整执行器的阶段覆盖键对应；新增模式须明确其必需阶段，不能退化为只验单测。 */
export function requiredModePhases(mode) {
  const common = [
    ['build', 'check/app-build'],
    ['build', 'check/probe-build'],
    ['check', 'check/app-tests'],
    ['check', 'check/script-tests'],
    ['check', 'check/resources/source']
  ]
  if (mode === 'common') return common
  if (mode === 'ios-build')
    return [...common, ['build', 'native-build/App/Release'], ['check', 'check/resources/device']]
  if (!['ios-smoke', 'ios-touch'].includes(mode)) throw new Error('未定义必需阶段：' + mode)
  // 同一覆盖键会跨组重复；以既有日志名区分实例，防止另一组的成功遮住本组缺失。
  const testRun = (name, target, coverage = 'native-startup/' + target) => [
    ['build', 'native-build/' + target, name + '-build.log'],
    ['install', 'native-install/' + target, name + '-install.log'],
    ['test', coverage, name + '.log']
  ]
  const native = [
    ...common,
    ['boot', 'native-boot'],
    ['build', 'native-build/App/Debug', 'prepare-build.log'],
    ['install', 'native-install/App/Debug', 'prepare-install.log'],
    ['initialize', 'native-initialize/App/Debug', 'prepare-host.log']
  ]
  if (mode === 'ios-smoke')
    return [
      ...native,
      ...testRun('test', 'App/Debug'),
      ...['snapshot-ready', 'migration-recorded', 'upgrade-committed'].flatMap((p) => [
        ...testRun('interruption-' + p, 'App/Debug', 'recovery/' + p),
        ...testRun('recovery-' + p, 'App/Debug', 'recovery/' + p)
      ])
    ]
  const rejection = 'case/NativeTests/NativeSqliteTests/testRejectUnownedTestContexts'
  const touchGroups = ['touch', 'touch-paging', 'touch-entry', 'touch-personal',
    'touch-lifecycle', 'touch-query', 'touch-report', 'touch-dimensions']
  return [
    ...native,
    ...testRun('touch-initialize', 'App/Debug'),
    ...testRun('touch-reject-hosted', 'App/Debug', rejection),
    ...testRun('touch-reject-ui', 'DictionaryTouch/Release', rejection),
    ...touchGroups.flatMap((name) => [
      ...testRun(name, 'DictionaryTouch/Release'),
      ['check', 'native-readback/DictionaryTouch/Release', name + '-readback.log']
    ]),
    ['check', 'check/resources/simulator']
  ]
}

/** 必需阶段必须实际完成并携带对应原日志；摘要重新计算不能弥补阶段缺失。 */
export function assertModePhases(mode, phases, raw) {
  if (!phases?.length || phases.some((p) => p.status !== 'passed')) throw new Error('阶段未完整通过。')
  for (const [stage, coverage, basename] of requiredModePhases(mode)) {
    const matching = phases.filter((p) =>
      p.stage === stage && p.coverage?.includes(coverage) &&
      (!basename || (typeof p.log === 'string' && path.basename(p.log) === basename))
    )
    if (!matching.length)
      throw new Error('缺少必需阶段：' + stage + '/' + coverage + (basename ? '/' + basename : ''))
    for (const phase of matching) {
      const log = raw(phase.log)
      if (coverage.startsWith('native-build/') && !/\*\* (?:TEST )?BUILD SUCCEEDED \*\*/.test(log))
        throw new Error('原生构建缺少实际成功记录：' + coverage)
    }
  }
}
