import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPlan, registry, executionMatrix, assertPlan, remoteSuite } from './lib/ios-ci-plan.mjs'
import { resultsDirectory, executeGroup, reconcile, archiveGroup,runCommand } from './lib/ios-ci-run.mjs'
import { requestedScope, requireJobs } from './lib/ios-ci.mjs'
import { localGate } from './lib/ios-local-gate.mjs'
import { errorMessage } from './lib/ios-errors.mjs'
import { registryDocumentation } from './lib/ios-ci-docs.mjs'
import { executeLocalGroup } from './lib/ios-local-delivery.mjs'

const root = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const args = process.argv.slice(2)
const guardRemote = directory => {
  if(process.env.GITHUB_ACTIONS!=='true')return
  const plan=assertPlan(root,JSON.parse(fs.readFileSync(path.join(directory,'ci-plan.json'),'utf8')))
  if(plan.execution!=='remote' || plan.suites.some(s=>!remoteSuite(s)))throw new Error('远端拒绝本地计划或模拟器专项。')
}
try {
  if (args[0] === 'docs') {
    if (args.length > 2 || (args[1] && args[1] !== '--write')) throw new Error('docs 仅接受 --write。')
    console.log(JSON.stringify(registryDocumentation(root, args[1] === '--write')))
  } else {
  const mode = args.shift(),
    options = {},
    explicit = args[0] && !args[0].startsWith('--') ? args.shift() : undefined
  const profile = explicit ?? 'change'
  if (explicit && mode !== 'plan') throw new Error('只有 plan 接受范围参数。')
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--execution','--base', '--head', '--results', '--group', '--attempt','--app','--candidate','--output','--input','--session','--from'].includes(args[i]) ||
      !args[i + 1] ||
      (args[i] !== '--from' && Object.hasOwn(options, args[i]))
    )
      throw new Error('CI 参数无效。')
    if (args[i] === '--from') (options['--from'] ??= []).push(args[i + 1])
    else options[args[i]] = args[i + 1]
  }
  const allowed =
    mode === 'plan'
      ? ['--base', '--head', '--results','--execution']
      : mode === 'run'
        ? ['--results', '--group','--session','--from']
        : mode === 'archive'
          ? ['--results', '--group', '--attempt']
          : mode === 'signing-check' ? ['--app','--candidate','--output']
        : mode === 'install-gate' ? ['--input','--output']
        : mode === 'local-gate' ? ['--results','--input']
        : mode === 'result'
            ? ['--results']
            : []
  if (Object.keys(options).some((k) => !allowed.includes(k)))
    throw new Error('参数不适用于该 CI 命令。')
  if (mode === 'local-gate') {
    if (process.env.GITHUB_ACTIONS === 'true') throw new Error('本地专项核验只能在可信本机执行。')
    if (!options['--results'] || !options['--input']) throw new Error('local-gate 必须提供 --results 与证据清单 --input。')
    const result = localGate(root, resultsDirectory(root, options['--results']), options['--input'])
    console.log(JSON.stringify(result, null, 2))
    if (result.status !== 'passed') process.exitCode = 1
  } else if (mode === 'require-jobs') {
    requireJobs(process.env.IOS_CI_PLAN_STATUS, process.env.IOS_CI_CHECKS_STATUS, process.env.IOS_CI_LOCAL_STATUS, process.env.IOS_CI_IS_PR === 'true')
    console.log('所有必需作业成功。')
  } else if (['signing-check','install-gate'].includes(mode)) {
    const names = mode==='signing-check' ? ['--app','--candidate','--output'] : ['--input','--output']
    if (names.some(name=>!options[name])) throw new Error('缺少可信手动入口参数。')
    const parent = path.join(root,'.local/ios/tmp/ai-agent')
    fs.mkdirSync(parent,{recursive:true,mode:0o700})
    const directory = fs.mkdtempSync(path.join(parent,'ios-gate-'))
    await runCommand(root,process.execPath,['scripts/ios-'+mode+'.mjs',...names.map(name=>options[name])],path.join(directory,'gate.log'),120000)
    console.log('GATE_RESULT='+path.resolve(options['--output']))
  } else if (mode === 'check' || mode === 'list') {
    const r = registry(root)
    console.log(
      JSON.stringify(
        mode === 'list' ? r.suites : { status: 'passed', suites: Object.keys(r.suites).length },
        null,
        2
      )
    )
  } else if (mode === 'prepare' || mode === 'plan') {
    if (
      mode === 'prepare' &&
      ![process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT].every((value) =>
        /^[1-9]\d*$/.test(value ?? '')
      )
    )
      throw new Error('远端运行 ID 或 attempt 无效。')
    let selected = { profile, base: options['--base'] }
    if (mode === 'prepare')
      selected = requestedScope(
        process.env.GITHUB_EVENT_NAME,
        JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
      )
    const plan = createPlan(root, selected.profile, {
      base: selected.base,
      head: selected.head ?? options['--head'],
      execution:mode==='prepare'?'remote':(options['--execution']??(process.env.GITHUB_ACTIONS==='true'?'remote':undefined))
    })
    const directory =
      options['--results'] ??
      (mode === 'prepare'
        ? `.local/ios/tmp/ai-agent/ios-ci-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
        : `.local/ios/tmp/ai-agent/ios-ci-${Date.now()}-${process.pid}`)
    const absolute = resultsDirectory(root, directory, true)
    fs.writeFileSync(path.join(absolute, 'ci-plan.json'), JSON.stringify(plan, null, 2), {
      flag: 'wx',
      mode: 0o600
    })
    const matrix = executionMatrix(plan)
    if (mode === 'prepare')
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `matrix=${JSON.stringify(matrix)}\ndirectory=${path.relative(root, absolute)}\nprofile=${plan.profile}\nartifact=ios-ci-plan-${process.env.GITHUB_RUN_ATTEMPT}\n`
      )
    console.log(
      JSON.stringify({
        directory: path.relative(root, absolute),
        profile: plan.profile,
        execution:plan.execution,
        localRequired:(plan.localRequired??[]).map(s=>s.name),
        deferred:(plan.deferred??[]).map(s=>s.name),
        suites: plan.suites.map((s) => s.name),
        matrix
      })
    )
  } else if (['run', 'result', 'archive'].includes(mode)) {
    if (!options['--results'])
      throw new Error('run/result 必须指定 --results，不隐式启动或覆盖旧运行。')
    const directory = resultsDirectory(root, options['--results'])
    if (mode === 'archive') {
      console.log(archiveGroup(root, directory, options['--group'], options['--attempt']))
    } else if (mode === 'run') {
      guardRemote(directory)
      if (process.env.GITHUB_ACTIONS === 'true' && options['--from']) throw new Error('远端不消费本机局部修复路径。')
      await (process.env.GITHUB_ACTIONS === 'true' ? executeGroup : executeLocalGroup)(root, directory, options['--group'], { session: options['--session'], evidence: options['--from'] })
      console.log('所选执行组通过；完整结论须由 result 对账。')
    } else {
      let result
      try {
        guardRemote(directory)
        const remote = process.env.GITHUB_ACTIONS === 'true'
        result = reconcile(root, directory,
          process.env.IOS_CI_CHECKS_STATUS ?? (remote ? 'missing' : undefined),
          process.env.IOS_CI_PLAN_STATUS ?? (remote ? 'missing' : undefined),
          { localEvidenceStatus: process.env.IOS_CI_IS_PR === 'true' ? process.env.IOS_CI_LOCAL_STATUS ?? 'missing' : undefined })
      } catch (error) {
        // 汇总损坏也刷新机器结论，不能遗留上次绿色；原计划和失败报告不修改。
        result = { schema: 1, status: 'incomplete', completeCandidate: false, error: errorMessage(error) }
        fs.writeFileSync(path.join(directory, 'ci-result.json'), JSON.stringify(result, null, 2), {
          mode: 0o600
        })
        fs.writeFileSync(
          path.join(directory, 'ci-result.md'),
          `CI incomplete: ${errorMessage(error)}\n`,
          { mode: 0o600 }
        )
      }
      if (process.env.GITHUB_OUTPUT)
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `complete=${result.completeCandidate}\n`)
      console.log(JSON.stringify(result, null, 2))
      if (result.status !== 'passed') process.exitCode = 1
    }
  } else
    throw new Error(
      '用法：ci:ios-app -- check|list；plan [change|scripts|common|app|final|套件] --base SHA；local-gate --results PATH --input JSON；run --results PATH --group linux|macos；result --results PATH。'
    )
  }
} catch (error) {
  console.error(errorMessage(error))
  process.exitCode = 1
}
