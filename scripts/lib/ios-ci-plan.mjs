import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { uiScenarios, uiCases, selection,capacityScenarios,recoveryScenarios } from './ios-debug.mjs'
import { contentHash, generated } from './ios-cache.mjs'
import { scriptSkipPolicy } from './ios-test-reports.mjs'
import { assertNpmSources } from './ios-ci.mjs'

export const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex')
export const registryPath = 'config/ios-ci.json'
const git = (root, ...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe']
  })

/** 登记只描述现有执行器和场景，不接受任意 Shell，也不注册尚未实现的交付能力。 */
export function registry(root) {
  const r = JSON.parse(fs.readFileSync(path.join(root, registryPath), 'utf8'))
  if (r.schema !== 1 || !r.suites || !r.profiles || !Array.isArray(r.rules))
    throw new Error('CI 登记结构无效。')
  scriptSkipPolicy(r)
  const names = Object.keys(r.suites)
  const validateNames = (values) => {
    if (
      !Array.isArray(values) ||
      !values.length ||
      new Set(values).size !== values.length ||
      values.some((n) => !names.includes(n))
    )
      throw new Error('CI 登记含未知、重复或空套件。')
  }
  for (const [name, s] of Object.entries(r.suites)) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(name) ||
      !['linux', 'macos'].includes(s.runner) ||
      !s.description ||
      !['secrets', 'check', 'engineering', 'full', 'ui', 'audit','scenario','installation','environment'].includes(s.kind) ||
      (s.kind === 'check' && s.check !== 'script-tests') ||
      (s.kind === 'engineering' && !['common', 'ios-build'].includes(s.mode)) ||
      (s.kind === 'full' && !['ios-smoke', 'ios-touch'].includes(s.mode)) ||
      (s.kind === 'ui' &&
        (s.case
          ? !uiCases.some((name) => s.case === 'DictionaryUITests/DictionaryTouchTests/' + name) ||
            Boolean(s.scenario)
          : !Object.hasOwn(uiScenarios, s.scenario))) ||
      (s.kind === 'scenario' && ![...recoveryScenarios,...capacityScenarios.filter(x=>/^scale-\d+$/.test(x))].includes(s.scenario)) ||
      ((['full', 'ui','scenario','installation','environment'].includes(s.kind) || s.mode === 'ios-build') && s.runner !== 'macos')
    )
      throw new Error('CI 套件定义无效：' + name)
  }
  for (const p of ['scripts', 'app', 'final']) validateNames(r.profiles[p])
  validateNames(r.changeBase)
  if (!r.changeBase.some(name => r.suites[name].kind === 'secrets'))
    throw new Error('CI 变更范围缺少必需 secret 门禁。')
  validateNames(r.onDemandSuites)
  const onDemand = names.filter(name => (r.suites[name].kind === 'full' && r.suites[name].mode === 'ios-touch') ||
    r.suites[name].kind === 'installation' ||
    (r.suites[name].kind === 'scenario' && /^scale-\d+$/.test(r.suites[name].scenario)))
  if (JSON.stringify([...r.onDemandSuites].sort()) !== JSON.stringify(onDemand.sort()))
    throw new Error('CI 按需套件必须且仅包含完整触摸、容量和手动安装。')
  for (const rule of [...r.rules,...(r.unknownSource ? [r.unknownSource] : [])]) {
    if (
      !Array.isArray(rule.paths) ||
      !rule.paths.length ||
      (rule.exclude && !Array.isArray(rule.exclude)) ||
      [...rule.paths, ...(rule.exclude ?? [])].some(
        (p) => typeof p !== 'string' || p.startsWith('/') || p.includes('..')
      )
    )
      throw new Error('CI 影响路径无效。')
    validateNames(rule.suites)
  }
  for (const [name, values] of Object.entries(r.supersedes)) {
    validateNames([name])
    validateNames(values)
    if (
      values.some(
        (n) =>
          r.suites[n].runner !== r.suites[name].runner ||
          !(
            (r.suites[name].kind === 'engineering' && r.suites[n].kind === 'check') ||
            (r.suites[name].mode === 'ios-touch' && r.suites[n].kind === 'ui')
          )
      )
    )
      throw new Error('CI 套件替代不能省略不同平台或未覆盖的门禁。')
  }
  const registeredCases = new Set(
    Object.values(r.suites)
      .filter((s) => s.kind === 'ui')
      .flatMap((s) => selection(s.case ? '--case' : '--scenario', s.case ?? s.scenario, []).cases)
  )
  if (
    uiCases.some((name) => !registeredCases.has('DictionaryUITests/DictionaryTouchTests/' + name))
  )
    throw new Error('UI 单用例或场景尚未登记，新增用例不能只由最终范围兜底。')
  const swift = fs.readFileSync(
    path.join(root, 'app/ios/App/UITests/DictionaryTouchTests.swift'),
    'utf8'
  )
  const discovered = [...swift.matchAll(/^\s*func\s+(test\w+)\s*\(/gm)].map((match) => match[1])
  if (discovered.some((name) => name !== 'test00DebugKeyboardReady' && !uiCases.includes(name)))
    throw new Error('Swift UI 新用例未接入局部选择器及套件登记。')
  // 固定候选的最小能力不由可编辑登记任意降级；变更专项和单套件不会生成完整候选。
  for (const [profile, required] of Object.entries({
    scripts: ['secrets', 'script-linux', 'script-macos'],
    app: ['secrets', 'common', 'ios-build', 'ios-smoke'],
    final: ['secrets', 'common', 'ios-build', 'ios-smoke', 'ios-touch', 'audit','scale-10000','scale-100000']
  })) {
    const selected = selectSuites(r, profile)
    for (const key of required)
      if (
        !selected.some(
          (s) =>
            s.kind === key ||
            s.mode === key ||
            (s.kind === 'scenario' && s.scenario === key) ||
            (key === 'script-linux' && s.kind === 'check' && s.runner === 'linux') ||
            (key === 'script-macos' && s.kind === 'check' && s.runner === 'macos')
        )
      )
        throw new Error('CI 固定范围缺少必需门禁：' + profile + '/' + key)
  }
  return r
}

/** 与 Git 一致按删除+新增处理改名；本地改动和新文件参与选择，未知范围明确拒绝。 */
export function changedPaths(root, base, head) {
  for (const sha of [base, head]) {
    if (!/^[a-f0-9]{40}$/i.test(sha ?? '') || /^0+$/.test(sha))
      throw new Error('change 必须提供可核实的完整 base/head SHA。')
    git(root, 'cat-file', '-e', sha + '^{commit}')
  }
  const committed = git(root, 'diff', '--no-renames', '--name-only', '-z', base, head, '--')
  const working = git(root, 'diff', '--no-renames', '--name-only', '-z', head, '--')
  const added = git(root, 'ls-files', '--others', '--exclude-standard', '-z')
  return [...new Set((committed + working + added).split('\0').filter(Boolean))].sort()
}

/** 摘要不绑定绝对工作目录或主机；同一提交可在 Linux/macOS 对账，未提交输入仍受保护。 */
export function sourceIdentity(root) {
  const files = git(
    root,
    'ls-files',
    '-co',
    '--exclude-standard',
    '-z',
    '--',
    'app',
    'scripts',
    '.github',
    registryPath,
    'package.json',
    '.nvmrc',
    'DESIGN.md',
    'AGENTS.md',
    'README.md',
    'agent-works/testing',
    'agent-works/architecture/environment-configuration.md'
  )
    .split('\0')
    .filter(Boolean)
  const hash = createHash('sha256')
  for (const file of [...new Set(files)].sort()) {
    hash.update(file + '\0')
    const absolute = path.join(root, file)
    let stat
    try {
      stat = fs.lstatSync(absolute)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      hash.update('missing')
      continue
    }
    if (!stat.isFile()) throw new Error('CI 输入不是普通文件：' + file)
    hash.update(String(stat.mode & 0o111) + '\0')
    hash.update(fs.readFileSync(absolute))
  }
  // 运行时消费的 App 源码即使被本机 Git 忽略也必须绑定；复用构建缓存的生成物排除规则。
  hash.update(
    contentHash(
      root,
      ['app/src', 'app/public', 'app/native-tests', 'app/test-support', 'app/ios/App'],
      generated
    )
  )
  return { commit: git(root, 'rev-parse', 'HEAD').trim(), hash: hash.digest('hex') }
}

/** 选中的专项可有多条理由；完整 touch 覆盖局部 UI，但局部不会反向替代完整。 */
export function selectSuites(r, profile, files = []) {
  if (!['change', 'pull-request', ...Object.keys(r.profiles), ...Object.keys(r.suites)].includes(profile))
    throw new Error('未知 CI 范围。')
  const change = ['change', 'pull-request'].includes(profile)
  const chosen = new Set(change ? r.changeBase : (r.profiles[profile] ?? [profile]))
  const reasons = Object.fromEntries([...chosen].map((n) => [n, [profile]]))
  if (change)
    for (const rule of r.rules) {
      const hits = files.filter(
        (file) =>
          rule.paths.some((pattern) => path.matchesGlob(file, pattern)) &&
          !(rule.exclude ?? []).some((pattern) => path.matchesGlob(file, pattern))
      )
      if (hits.length)
        for (const name of rule.suites) {
          chosen.add(name)
          reasons[name] = [...new Set([...(reasons[name] ?? []), ...hits])]
        }
    }
  if (change && r.unknownSource) {
    const fallback = r.unknownSource
    for (const file of files) {
      const known = r.rules.some(rule=>rule.suites.some(name=>!['secrets','app-common','scripts','scripts-macos'].includes(name)) &&
        rule.paths.some(pattern=>path.matchesGlob(file,pattern)) && !(rule.exclude ?? []).some(pattern=>path.matchesGlob(file,pattern)))
      if (!known && fallback.paths.some(pattern=>path.matchesGlob(file,pattern)) && !(fallback.exclude ?? []).some(pattern=>path.matchesGlob(file,pattern)))
        for (const name of fallback.suites) {chosen.add(name);reasons[name]=[...(reasons[name] ?? []),'unknown:'+file]}
    }
  }
  if (profile === 'pull-request') for (const name of r.onDemandSuites) chosen.delete(name)
  for (const name of chosen) for (const covered of r.supersedes[name] ?? []) chosen.delete(covered)
  return Object.keys(r.suites)
    .filter((name) => chosen.has(name))
    .map((name) => ({ name, ...r.suites[name], reasons: reasons[name] }))
}

export function createPlan(root, profile, { base, head } = {}) {
  assertNpmSources(JSON.parse(fs.readFileSync(path.join(root, 'app/package-lock.json'), 'utf8')))
  const r = registry(root),
    source = sourceIdentity(root)
  head ??= source.commit
  if (head !== source.commit) throw new Error('被测 head 必须等于当前检出提交。')
  let files = [], range = null
  if (['change', 'pull-request'].includes(profile)) {
    files = changedPaths(root, base, head)
    range = { base, head }
    if (profile === 'pull-request') {
      range.mergeBase = git(root, 'merge-base', base, head).trim()
      files = changedPaths(root, range.mergeBase, head)
    }
  }
  const suites = selectSuites(r, profile, files)
  const deferred = profile === 'pull-request'
    ? selectSuites(r, 'change', files).filter(s => r.onDemandSuites.includes(s.name))
    : []
  const plan = {
    schema: 1,
    profile,
    source,
    range,
    registryHash: digest(r),
    files,
    suites,
    ...(profile === 'pull-request' ? { deferred } : {})
  }
  return { ...plan, id: digest(plan) }
}

/** 普通工具组保留十分钟外层限制；实际原生组沿用四十五分钟，不重置内层阶段预算。 */
export function executionMatrix(plan) {
  return {
    include: [...new Set(plan.suites.map((s) => s.runner))].map((group) => ({
      group,
      runner: group === 'linux' ? 'ubuntu-latest' : 'xcode-27',
      timeout:
        group === 'macos' &&
        plan.suites.some(
          (s) => s.runner === group && ['engineering', 'full', 'ui','scenario'].includes(s.kind)
        )
          ? 45
          : 10
    }))
  }
}

/** 在执行和总对账时重新规划，不接受手填轻量范围、旧源码或删掉必跑项的计划。 */
export function assertPlan(root, plan) {
  const current = createPlan(root, plan.profile, plan.range ?? {})
  if (JSON.stringify(current) !== JSON.stringify(plan))
    throw new Error('CI 计划、源码、登记或变更范围已失效。')
  return current
}
