import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { git, notesRef, readEnvelope, requiredLocalSuites, verifyEnvelope, noteParent } from './lib/ios-local-delivery.mjs'
import { errorMessage } from './lib/ios-errors.mjs'

const root = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const repository = process.env.GITHUB_REPOSITORY, number = process.env.IOS_EVIDENCE_PR
const publish = process.env.IOS_EVIDENCE_PUBLISH === 'true'
const api = (endpoint, body) => JSON.parse(execFileSync('gh', ['api', endpoint, ...(body ? ['--method', 'POST', '--input', '-'] : [])], {
  cwd: root, input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', timeout: 30000,
  maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
}))
let head, base
function status(state, description) {
  api(`repos/${repository}/statuses/${head}`, { context: 'Local evidence result', state, description,
    target_url: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` })
}

try {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('回执仓库身份无效。')
  let pull
  if (publish) {
    if (!['pull_request_target', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) || !/^[1-9]\d*$/.test(number ?? ''))
      throw new Error('只有可信元数据工作流可发布本地门禁。')
    pull = api(`repos/${repository}/pulls/${number}`)
    const metadata = api(`repos/${repository}`)
    if (pull.state !== 'open' || pull.base.repo.full_name !== repository || pull.base.ref !== metadata.default_branch ||
        process.env.GITHUB_REF !== 'refs/heads/' + metadata.default_branch) throw new Error('PR 已关闭或不是可信默认主线。')
    head = pull.head.sha; base = pull.base.sha
  } else { head = process.env.IOS_EVIDENCE_HEAD; base = process.env.IOS_EVIDENCE_BASE }
  if (![head, base].every(value => /^[a-f0-9]{40}$/.test(value ?? ''))) throw new Error('回执 head/base 必须为完整 SHA。')
  if (publish) status('pending', '正在核验本地必需专项；不启动模拟器')
  git(root, 'fetch', '--no-tags', 'origin', head, base)
  const required = requiredLocalSuites(root, base, head)
  let envelope, observed
  const ref = 'refs/notes/ios-local-read-' + randomUUID()
  try {
    if (required.length) {
      observed = git(root, 'ls-remote', 'origin', notesRef).split(/\s/)[0]
      if (!observed) throw new Error('缺少本地必需专项的已签名回执。')
      git(root, 'fetch', '--no-tags', 'origin', notesRef + ':' + ref)
      if (git(root, 'rev-parse', ref) !== observed) throw new Error('回执发布正在变化，不能消费混合快照。')
      envelope = readEnvelope(root, ref, head)
    }
    const result = verifyEnvelope(envelope, { repository, head, base,
      tree: git(root, 'rev-parse', head + '^{tree}'), required,
      previousNotesSha: required.length ? noteParent(root, ref, head) : undefined,
      signers: JSON.parse(process.env.IOS_LOCAL_EVIDENCE_SIGNERS || '{}') })
    if (publish) {
      const current = api(`repos/${repository}/pulls/${number}`)
      if (current.state !== 'open' || current.head.sha !== head || current.base.sha !== base)
        throw new Error('PR 已更新，本轮不得发布旧成功。')
      if (required.length && git(root, 'ls-remote', 'origin', notesRef).split(/\s/)[0] !== observed)
        throw new Error('本地回执已更新，本轮不得发布旧成功。')
      status('success', required.length ? '本地必需专项回执齐全且签名有效' : '本次变更无必需本地专项')
    }
    console.log(JSON.stringify({ ...result, head, base, completeCandidate: false }))
  } finally { git(root, 'update-ref', '-d', ref) }
} catch (error) {
  if (publish && head) {
    try {
      const current = api(`repos/${repository}/pulls/${number}`)
      if (current.state === 'open' && current.head.sha === head && current.base.sha === base)
        status('failure', '本地必需专项缺失、失败或回执失效；查看本轮日志')
    }
    catch (publication) { console.error('门禁失败状态发布失败：' + errorMessage(publication)) }
  }
  console.error(errorMessage(error)); process.exitCode = 1
}
