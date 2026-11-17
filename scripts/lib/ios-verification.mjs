import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readSession, sourceHash, hashPaths, selection } from './ios-debug.mjs'

export const controlInputs = ['scripts/ios-app.sh', 'scripts/ios-app.mjs', 'scripts/lib',
  'scripts/fixtures/dictionary-touch.py', 'scripts/verify-ios-resources.mjs', 'scripts/ios-storage-policy.mjs',
  'scripts/tests/ios-debug.test.mjs', 'scripts/tests/ios-verification.test.mjs', 'scripts/tests/ios-resources.test.mjs',
  'scripts/toolchain.sh', 'package.json', '.nvmrc']

/** 测试准备/夹具和执行器也属于证据输入；不因修改 README 或生成物而作废。 */
export function verificationHash(root, toolchain) {
  return createHash('sha256').update(sourceHash(root, toolchain) + hashPaths(root, controlInputs)).digest('hex')
}
const directory = root => path.join(root, '.local/ios/tmp/ai-agent')
const stateFile = root => path.join(directory(root), 'ios-verification-state.json')
function readState(root) {
  if (!fs.existsSync(stateFile(root))) return { schema: 1, attempts: {} }
  const state = JSON.parse(fs.readFileSync(stateFile(root), 'utf8'))
  if (state.schema !== 1 || !state.attempts || typeof state.attempts !== 'object') throw new Error('完整验收状态损坏，先排查，不自动清空。')
  return state
}
function writeJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/** --from 只接受 CLI 在受管会话中生成的当前版本成功回执，不接受任意 JSON。 */
export function requireEvidence(root, input, fingerprint) {
  if (!input) throw new Error('完整验收前必须先通过局部验证，并用 --from RUN_DIRECTORY 指定成功证据。')
  const run = path.resolve(input)
  const session = readSession(directory(root), path.dirname(run), true)
  if (!/^run-[A-Za-z0-9]+$/.test(path.basename(run)) || fs.realpathSync(run) !== run) throw new Error('拒绝非受管局部证据路径。')
  const file = path.join(run, 'result.json')
  if (!fs.lstatSync(file).isFile()) throw new Error('局部回执必须是普通文件。')
  const result = JSON.parse(fs.readFileSync(file, 'utf8'))
  const scenarios = JSON.parse(fs.readFileSync(path.join(root, 'app/native-tests/scenarios.json'), 'utf8'))
  const selected = selection('--' + result.requested?.kind, result.requested?.name, scenarios)
  if (result.scope !== 'partial' || result.status !== 'passed' || result.verificationHash !== fingerprint
    || result.runId !== session.context.runId || result.simulatorId !== session.context.simulatorId
    || !Number.isSafeInteger(result.completedAt) || result.completedAt > Date.now()
    || JSON.stringify(result.executedCases) !== JSON.stringify(selected.cases)) throw new Error('局部证据失败、过期、版本不符或范围不符，必须重新局部验证。')
  const log = fs.readFileSync(path.join(run, 'test.log'), 'utf8')
  for (const id of selected.cases) if (!log.includes(` ${id.split('/').at(-1)}]' passed`)) throw new Error('局部证据缺少实际目标通过记录。')
  if (!log.includes(`Executed ${selected.cases.length} test${selected.cases.length === 1 ? '' : 's'}, with 0 failures`)) throw new Error('局部证据实际数量不符。')
  return { run, result }
}

/** 同工作区跨会话保存失败锁；换模拟器、换证据路径或重启命令不能解锁。 */
export function beginFull(root, mode, evidence, fingerprint, ownerPid) {
  const state = readState(root)
  const unresolved = Object.entries(state.attempts).filter(([, a]) => a.status !== 'passed')
    .sort((a, b) => b[1].startedAt - a[1].startedAt)[0]
  if (unresolved) {
    const [failedMode, previous] = unresolved
    if (failedMode !== mode) throw new Error(`先处理 ${failedMode} 的未完成/失败验收，不能转跑另一套完整验收。`)
    if (previous.fingerprint === fingerprint && previous.retry >= 1) {
      throw new Error('同一输入的完整复验已再次失败/中断；必须先定位并修改相关输入，禁止仅重跑局部绿色继续解锁。')
    }
    if (evidence.result.completedAt <= (previous.finishedAt ?? previous.startedAt) || evidence.run === previous.evidence) {
      throw new Error('完整验收失败或中断后必须转局部：需要失败之后新产生的成功证据，不能复用原回执。')
    }
    if (previous.failedCases?.length && !previous.failedCases.every(id => evidence.result.executedCases.includes(id))) {
      throw new Error(`局部证据未覆盖失败用例：${previous.failedCases.join(', ')}；没有对应局部入口时先补入口，不重跑完整套件。`)
    }
    if (!previous.failedCases?.length) {
      const expected = mode === 'ios-touch' ? 'DictionaryUITests/' : 'NativeTests/'
      if (!evidence.result.executedCases.some(id => id.startsWith(expected))) throw new Error('环境/准备失败后，需要同类局部启动验证，不能用另一类证据解锁。')
    }
  } else {
    const expected = mode === 'ios-touch' ? 'DictionaryUITests/' : 'NativeTests/'
    if (!evidence.result.executedCases.some(id => id.startsWith(expected))) throw new Error('局部证据与完整验收类型不匹配。')
  }
  if (state.attempts[mode]?.status === 'passed' && state.attempts[mode].fingerprint === fingerprint) {
    throw new Error('相同源码、测试、执行器和工具链的完整验收已通过，拒绝重复；新增风险先补局部回归，不设强制重跑开关。')
  }
  const run = fs.mkdtempSync(path.join(directory(root), 'ios-full-'))
  const previous = state.attempts[mode]
  const retry = previous?.fingerprint === fingerprint ? previous.retry + 1 : 0
  const attempt = { mode, status: 'running', startedAt: Date.now(), ownerPid, fingerprint, evidence: evidence.run, run, retry, failedCases: [] }
  state.attempts[mode] = attempt
  writeJson(stateFile(root), state)
  writeJson(path.join(run, 'result.json'), attempt)
  return attempt
}
export function finishFull(root, attempt, error, failedCases = []) {
  const state = readState(root)
  if (state.attempts[attempt.mode]?.run !== attempt.run) throw new Error('验收状态归属变化，拒绝覆盖。')
  const result = { ...attempt, status: error ? 'failed' : 'passed', finishedAt: Date.now(), failedCases, error: error?.message }
  writeJson(path.join(attempt.run, 'result.json'), result)
  state.attempts[attempt.mode] = result
  writeJson(stateFile(root), state)
}

/** 内部 Shell 必须持有调度器仍在运行的许可；直接执行不能绕过证据门禁。 */
export function requireActiveFull(root, mode, run) {
  const attempt = readState(root).attempts[mode]
  const lock = JSON.parse(fs.readFileSync(path.join(directory(root), 'ios-command.lock/owner.json'), 'utf8'))
  if (!attempt || attempt.status !== 'running' || attempt.run !== run || attempt.ownerPid !== lock.pid) throw new Error('内部完整入口缺少有效调度许可，请经根目录命令提供 --from 局部证据。')
  process.kill(attempt.ownerPid, 0)
  return attempt
}

/** 只观察正例 XCTest 日志；隔离守卫/主动中断的预期失败不注册，因此不会误停。 */
export function observeFull(attempt, { now = Date.now, startupMs = 180_000 } = {}) {
  let step
  let offset = 0
  let buffer = ''
  let started = false
  const failedCases = []
  return {
    failedCases,
    poll() {
      const progress = path.join(attempt.run, 'progress.json')
      if (!fs.existsSync(progress)) return
      const next = JSON.parse(fs.readFileSync(progress, 'utf8'))
      if (next.log !== step?.log) { step = next; offset = 0; buffer = ''; started = false }
      const logDirectory = path.dirname(step.log)
      if (!path.isAbsolute(step.log) || path.dirname(logDirectory) !== path.dirname(attempt.run)
        || !/^native-[A-Za-z0-9]+$/.test(path.basename(logDirectory))
        || fs.realpathSync(logDirectory) !== logDirectory) throw new Error('验收进度日志越界。')
      if (fs.existsSync(step.log)) {
        if (!fs.lstatSync(step.log).isFile()) throw new Error('验收进度日志必须是普通文件。')
        const size = fs.statSync(step.log).size
        if (size > offset) {
          const length = Math.min(size - offset, 1_048_576)
          const fd = fs.openSync(step.log, 'r')
          const data = Buffer.alloc(length)
          try { fs.readSync(fd, data, 0, length, offset) } finally { fs.closeSync(fd) }
          offset += length; buffer += data.toString()
          const lines = buffer.split('\n'); buffer = lines.pop()
          for (const line of lines) {
            if (/Test Case .* started\./.test(line)) started = true
            const match = line.match(/Test Case '-\[([^\.]+)\.([^ ]+) ([^\]]+)\]' (failed|exceeded execution time allowance)/)
            if (match) {
              failedCases.push(`${match[1]}/${match[2]}/${match[3]}`)
              throw new Error(`正例用例失败，立即停止完整验收并转局部：${failedCases.at(-1)}；日志：${step.log}`)
            }
          }
          if (buffer.length > 1_048_576) throw new Error('验收日志单行超限。')
        }
      }
      if (!started && now() - step.startedAt > startupMs) throw new Error(`XCTest 在 180 秒内未进入用例，停止完整验收；先做同类局部启动验证。日志：${step.log}`)
    },
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, mode, run, log] = process.argv.slice(2)
    const root = process.cwd()
    requireActiveFull(root, mode, run)
    if (action === 'step') writeJson(path.join(run, 'progress.json'), { log, startedAt: Date.now() })
    else if (action !== 'permit') throw new Error('未知验收内部操作。')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
