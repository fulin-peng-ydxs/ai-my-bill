import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { git, automaticLocalGate, sealEvidence, publishEnvelope, notesRef, requiredLocalSuites } from './lib/ios-local-delivery.mjs'
import { registryBlock, registryDocumentation } from './lib/ios-ci-docs.mjs'
import { createSigner, loadSigner } from './lib/ios-local-signing.mjs'
import { createPlan, registry } from './lib/ios-ci-plan.mjs'
import { resultsDirectory, reconcile } from './lib/ios-ci-run.mjs'
import { executeLocalGroup } from './lib/ios-local-delivery.mjs'
import { writeJson } from './lib/ios-verification.mjs'
import { errorMessage } from './lib/ios-errors.mjs'

const root = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const gitDirectory = git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir')
const configFile = path.join(gitDirectory, 'codex/local-gate.json')
const readConfig = () => {
  if (!fs.existsSync(configFile)) throw new Error('尚未安装本地门禁：运行 npm run setup:local -- --base codex/offline-ios-app。')
  if (!fs.lstatSync(configFile).isFile() || fs.realpathSync(configFile) !== configFile) throw new Error('本地门禁配置不能为链接。')
  const c = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.repository ?? '') || !/^[\w.-]+$/.test(c.remote ?? '') ||
      typeof c.remoteUrl !== 'string' || !c.remoteUrl || !/^[\w][\w./-]*$/.test(c.base ?? '') || c.base.includes('..')) throw new Error('本地门禁仓库/分支配置无效。')
  if (c.previousHooks && path.resolve(root, c.previousHooks) === path.join(root, '.githooks')) throw new Error('既有 hook 指向受管入口自身，拒绝递归。')
  return c
}
const gh = args => execFileSync('gh', args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const baseSha = (config, fetch = false) => {
  if (fetch) git(root, 'fetch', '--no-tags', config.remote, `refs/heads/${config.base}:refs/remotes/${config.remote}/${config.base}`)
  return git(root, 'rev-parse', `refs/remotes/${config.remote}/${config.base}^{commit}`)
}

/** Keep existing hooks in their original directory, propagating refusal before the managed hook runs. */
function previousHook(config, hook, args, input) {
  if (!config.previousHooks) return
  const file = path.resolve(root, config.previousHooks, hook)
  if (!fs.existsSync(file)) return
  try { fs.accessSync(file, fs.constants.X_OK) } catch { return }
  const child = spawnSync(file, args, { cwd: root, input, stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'] })
  if (child.error || child.status !== 0) throw new Error('既有 Git hook 拒绝：' + hook)
}

function checkStagedRegistry() {
  const names = git(root, 'diff', '--cached', '--name-only', '-z').split('\0')
  if (!names.some(n => ['config/ios-ci.json', 'agent-works/testing/guide.md', 'scripts/lib/ios-ci-docs.mjs'].includes(n))) return
  const r = registry(root, JSON.parse(git(root, 'show', ':config/ios-ci.json')))
  const text = git(root, 'show', ':agent-works/testing/guide.md')
  const block = registryBlock(r)
  if (!text.includes(block) || text.split('<!-- ios-ci-registry:start -->').length !== 2 || text.split('<!-- ios-ci-registry:end -->').length !== 2)
    throw new Error('暂存区的套件生成文档与登记不一致；生成并暂存后再提交。')
}

/** Refresh an existing PR after a notes-only update. Dispatch runs only the trusted metadata verifier. */
function refreshPullRequest(config) {
  const branch = git(root, 'branch', '--show-current')
  const pulls = JSON.parse(gh(['api', `repos/${config.repository}/pulls?state=open&base=${encodeURIComponent(config.base)}&head=${encodeURIComponent(config.repository.split('/')[0] + ':' + branch)}`]))
  if (!pulls.length) return
  if (pulls.length !== 1) throw new Error('存在多个同源 PR，拒绝猜测回执消费目标。')
  gh(['workflow', 'run', 'local-evidence.yml', '--repo', config.repository, '--ref', config.base, '-f', 'pr_number=' + pulls[0].number])
}

function preparePublication(config) {
  const base = baseSha(config, true), required = requiredLocalSuites(root, base, git(root, 'rev-parse', 'HEAD'))
  let failureMessage
  if (required.length) {
    const previousNotesSha = git(root, 'ls-remote', config.remote, notesRef).split(/\s/)[0] || null
    const envelope = sealEvidence(root, base, config.repository, config.signer.keyId, loadSigner(config.signer), Date.now(), { publishFailure: true, previousNotesSha })
    publishEnvelope(root, config.remote, envelope, { [config.signer.keyId]: config.signer.publicKey })
    if (envelope.payload.status !== 'passed') failureMessage = '本地专项缺失或失效：' + required.map(s => s.name).join(', ')
  }
  if (failureMessage) {
    let publication
    try { refreshPullRequest(config) } catch (error) { publication = error }
    const failure = new Error(failureMessage + '；运行 npm run verify:local，仅补缺失专项。')
    throw publication ? new AggregateError([failure, publication], '本地漏验且远端失败刷新受阻') : failure
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS === 'true') throw new Error('本地开发/签名入口不能在远端运行。')
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'setup') {
    if (args.length !== 2 || args[0] !== '--base' || !/^[\w][\w./-]*$/.test(args[1]) || args[1].includes('..'))
      throw new Error('用法：setup --base 已核实的目标分支。')
    let config
    if (fs.existsSync(configFile)) config = readConfig()
    else {
      const previous = spawnSync('git', ['config', '--path', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' })
      if (![0, 1].includes(previous.status)) throw new Error('无法读取已有 hooks 配置。')
      if (previous.stdout.trim() && path.resolve(root, previous.stdout.trim()) === path.join(root, '.githooks')) throw new Error('已有受管 hook 但缺少配置，先核对归属。')
      config = { schema: 1, base: args[1], remote: 'origin', repository: JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner,
        remoteUrl: git(root, 'remote', 'get-url', '--push', 'origin'),
        previousHooks: previous.stdout.trim() || path.join(gitDirectory, 'hooks'), signer: createSigner() }
      if (config.previousHooks === '.githooks') throw new Error('已有受管 hook 但缺少配置，先核对归属。')
      fs.mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 })
      writeJson(configFile, config)
    }
    if (config.base !== args[1]) throw new Error('已安装门禁的目标分支不同，不能隐式切换。')
    baseSha(config, true)
    // Read-modify-write only the public signer map, preserving other authorized developers.
    let signers = {}
    const response = spawnSync('gh', ['api', `repos/${config.repository}/actions/variables/IOS_LOCAL_EVIDENCE_SIGNERS`], { cwd: root, encoding: 'utf8', timeout: 30000 })
    if (response.status === 0) signers = JSON.parse(JSON.parse(response.stdout).value)
    else if (!response.stdout.includes('"status":"404"') && !response.stdout.includes('"status": "404"')) throw new Error('无法读取远端公钥登记。')
    signers[config.signer.keyId] = config.signer.publicKey
    gh(['variable', 'set', 'IOS_LOCAL_EVIDENCE_SIGNERS', '--repo', config.repository, '--body', JSON.stringify(signers)])
    git(root, 'config', '--local', 'core.hooksPath', '.githooks')
    console.log('本地 hook 与公钥登记已安装；私钥仅在本机钥匙串。')
    return
  }
  const config = readConfig()
  if (['pre-commit', 'post-commit', 'pre-push'].includes(mode)) {
    const input = mode === 'pre-push' ? fs.readFileSync(0, 'utf8') : undefined
    previousHook(config, mode, args, input)
    if (mode === 'pre-commit') { checkStagedRegistry(); console.log('提交轻量检查通过；未启动模拟器。'); return }
    if (mode === 'post-commit') {
      const base = baseSha(config), head = git(root, 'rev-parse', 'HEAD'), required = requiredLocalSuites(root, base, head)
      writeJson(path.join(gitDirectory, 'codex/local-candidate.json'), {
        head, base, required: required.map(s => s.name), status: required.length ? 'pending-verification' : 'not-required'
      })
      console.log('提交已保存；本地专项：' + (required.map(s => s.name).join(', ') || '不适用') + '。推送前核验证据，未启动模拟器。')
      return
    }
    const updates = input.trim().split('\n').filter(Boolean).map(line => line.split(/\s+/))
    if (args[0] !== config.remote || args[1] !== config.remoteUrl || args[1] !== git(root, 'remote', 'get-url', '--push', config.remote)) throw new Error('推送目标与受管仓库不符。')
    if (updates.length && updates.every(row => row.length === 4 && row[2] === notesRef)) return
    if (updates.some(row => row[2] === 'refs/heads/' + config.base)) throw new Error('目标主线须通过 PR。')
    const live = updates.filter(row => !/^0{40}$/.test(row[1]))
    if (!live.length) return
    const head = git(root, 'rev-parse', 'HEAD')
    if (live.some(row => row.length !== 4 || !row[2].startsWith('refs/heads/') || row[1] !== head || row[2] === 'refs/heads/' + config.base))
      throw new Error('受管推送仅接受当前功能分支 HEAD；目标主线须通过 PR。')
    preparePublication(config)
    console.log('推送前本地必需专项核验通过；没有重复测试。')
    return
  }
  if (args.length) throw new Error('该本地命令不接受额外参数。')
  if (mode === 'status') {
    console.log(JSON.stringify(automaticLocalGate(root, baseSha(config)).result, null, 2)); return
  }
  if (mode === 'verify') {
    const base = baseSha(config, true)
    let gate = automaticLocalGate(root, base)
    for (const name of gate.missing) {
      const plan = createPlan(root, name), directory = resultsDirectory(root, '.local/ios/tmp/ai-agent/ios-ci-local-' + randomUUID(), true)
      writeJson(path.join(directory, 'ci-plan.json'), plan)
      await executeLocalGroup(root, directory, 'macos')
      const result = reconcile(root, directory)
      if (result.status !== 'passed') throw new Error('本地专项未通过：' + name)
    }
    gate = automaticLocalGate(root, base)
    if (gate.result.status !== 'passed') throw new Error(gate.result.error)
    console.log('必需本地专项通过；有效证据已复用。'); return
  }
  if (mode === 'push') {
    const branch = git(root, 'branch', '--show-current')
    if (!branch || branch === config.base) throw new Error('请在功能分支推送，目标主线须通过 PR。')
    preparePublication(config)
    git(root, 'push', '--set-upstream', config.remote, 'HEAD:refs/heads/' + branch)
    refreshPullRequest(config)
    console.log('功能分支推送完成；已有 PR 的回执核验已请求。'); return
  }
  throw new Error('用法：ios-local setup --base BRANCH | status | verify | push。')
}
try { await main() } catch (error) { console.error(errorMessage(error)); process.exitCode = 1 }
