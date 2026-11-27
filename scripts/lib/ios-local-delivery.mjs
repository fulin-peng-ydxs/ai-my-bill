import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID, sign, verify, createPublicKey } from 'node:crypto'
import { createPlan, requiredLocalFromPolicies, remoteSuite, digest, changeContents } from './ios-ci-plan.mjs'
import { localGate } from './ios-local-gate.mjs'
import { resultsDirectory, executeGroup } from './ios-ci-run.mjs'
import { writeJson } from './ios-verification.mjs'
import { equivalentSuiteInputs } from './ios-equivalent-evidence.mjs'

export const notesRef = 'refs/notes/ios-local-evidence'
const read = file => {
  if (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file) throw new Error('本地配置或证据必须为普通文件。')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
export const git = (root, ...args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
}).trim()
const catalogDirectory = root => path.join(root, '.local/ios/tmp/ai-agent/ios-ci-local-index')
const catalogEntries = root => {
  const directory = catalogDirectory(root)
  if (!fs.existsSync(directory)) return []
  resultsDirectory(root, directory)
  const names = fs.readdirSync(directory).filter(name => /^attempt-[a-f0-9-]{36}\.json$/.test(name))
  if (names.length > 10000) throw new Error('本地证据索引超过上限，先整理已归档历史。')
  return names.flatMap(name => read(path.join(directory, name)).entries)
}
const definition = suite => { const { name, reasons, ...value } = suite; return digest(value) }

/** Record every finished attempt, including failures. Never replace the latest failure with an older success. */
export function rememberLocalResult(root, directory) {
  const plan = read(path.join(directory, 'ci-plan.json'))
  if (plan.execution !== 'local') return
  const entries = []
  for (const suite of plan.suites.filter(s => !remoteSuite(s))) {
    const receiptFile = path.join(directory, suite.name, 'receipt.json')
    const groupFile = path.join(directory, `group-${suite.runner}.json`)
    const group = fs.existsSync(groupFile) ? read(groupFile) : { status: 'failed', startedAt: Date.now() }
    const receipt = fs.existsSync(receiptFile) ? read(receiptFile) : undefined
    entries.push({ suite: suite.name, input: plan.measurementInput, scopeInput: plan.measurementScopes?.[suite.name], directory: path.relative(root, directory),
      startedAt: receipt?.startedAt ?? group.startedAt ?? Date.now(), completedAt: receipt?.completedAt ?? Date.now(),
      order: process.hrtime.bigint().toString(),
      status: receipt?.status === 'passed' && group.status === 'passed' ? 'passed' : 'failed' })
  }
  if (!entries.length) return
  const directoryPath = catalogDirectory(root)
  try { resultsDirectory(root, directoryPath, !fs.existsSync(directoryPath)) }
  catch (error) { if (error.code !== 'EEXIST') throw error; resultsDirectory(root, directoryPath) }
  // Independent complete files are atomically published: concurrent writers do not need a stale-prone lock.
  writeJson(path.join(directoryPath, 'attempt-' + randomUUID() + '.json'), { schema: 1, entries })
}

/** Publish an unfinished attempt before launch, preserve both execution and bookkeeping failures on exit. */
export async function executeLocalGroup(root, directory, group, options) {
  let primary
  try {
    rememberLocalResult(root, directory)
    await executeGroup(root, directory, group, options)
  } catch (error) { primary = error }
  finally {
    try { rememberLocalResult(root, directory) }
    catch (error) { primary = primary ? new AggregateError([primary, error], '执行失败且本地证据登记失败') : error }
  }
  if (primary) throw primary
}

/** Only required suites participate: unrelated evidence, including its failures, cannot block a documentation push. */
export function automaticLocalGate(root, base, options = {}) {
  const plan = createPlan(root, 'pull-request', { base })
  const directory = resultsDirectory(root, '.local/ios/tmp/ai-agent/ios-ci-gate-' + randomUUID(), true)
  writeJson(path.join(directory, 'ci-plan.json'), plan)
  const rows = plan.localRequired.length ? catalogEntries(root) : []
  const directories = new Set(), missing = [], barriers = {}
  for (const suite of plan.localRequired) {
    const accepted = equivalentSuiteInputs(root,suite)
    const entries = rows.filter(r => r.suite === suite.name &&
      (r.status !== 'passed' || (r.scopeInput ? accepted.includes(r.scopeInput) : r.input === plan.measurementInput)))
      .sort((a, b) => b.startedAt - a.startedAt || b.completedAt - a.completedAt || (BigInt(b.order) > BigInt(a.order) ? 1 : -1))
    if (entries[0]?.status !== 'passed') {
      if (entries.length) barriers[suite.name] = entries[0].completedAt ?? entries[0].startedAt
    }
    else directories.add(entries[0].directory)
  }
  writeJson(path.join(directory, 'inputs.json'), [...directories])
  const result = localGate(root, directory, path.join(directory, 'inputs.json'), { reuse: true, ...options, barriers })
  for (const row of result.suites.filter(s => s.status !== 'passed')) if (!missing.includes(row.suite)) missing.push(row.suite)
  if (missing.length) {
    result.status = 'incomplete'
    result.error = '必需本地专项缺失或最近尝试失败：' + missing.join(', ')
    writeJson(path.join(directory, 'local-readiness.json'), result)
  }
  return { directory, plan, result, missing }
}

/** Signed delivery metadata is separate from immutable measurements; neither reports nor commits are rewritten. */
export function sealEvidence(root, base, repository, keyId, privateKey, now = Date.now(), gateOptions = {}) {
  if (git(root, 'status', '--porcelain', '--untracked-files=normal')) throw new Error('发布回执要求干净提交；未提交修改不能绑定为 HEAD 成功。')
  const gate = automaticLocalGate(root, base, gateOptions)
  if (gate.result.status !== 'passed' && !gateOptions.publishFailure) throw new Error(gate.result.error)
  const payload = {
    schema: 1, repository, head: gate.plan.source.commit, base,
    tree: git(root, 'rev-parse', 'HEAD^{tree}'), keyId, issuedAt: now,
    previousNotesSha: gateOptions.previousNotesSha ?? null,
    status: gate.result.status, completeCandidate: false,
    suites: gate.result.suites.map(row => ({ name: row.suite, status: row.status,
      definition: definition(gate.plan.localRequired.find(s => s.name === row.suite)),
      input: row.measurementInput, reportHash: row.reportHash, host: row.host,
      environmentHash: row.environmentHash, completedAt: row.completedAt }))
  }
  return { payload, signature: sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64') }
}

/** The verifier reads policy and commit objects as data; it never runs a PR's code or accepts its claimed suite list. */
export function requiredLocalSuites(root, base, head) {
  const mergeBase = git(root, 'merge-base', base, head)
  const files = git(root, 'diff', '--no-renames', '--name-only', '-z', mergeBase, head, '--').split('\0').filter(Boolean)
  const baseRegistry = JSON.parse(git(root, 'show', base + ':config/ios-ci.json'))
  const headRegistry = JSON.parse(git(root, 'show', head + ':config/ios-ci.json'))
  return requiredLocalFromPolicies(baseRegistry, headRegistry, files, changeContents(root, files, mergeBase, head))
}

export function verifyEnvelope(envelope, { repository, head, base, tree, required, signers, previousNotesSha, now = Date.now() }) {
  if (!required.length) return { status: 'passed', applicable: false, suites: [] }
  const p = envelope?.payload
  const publicKey = p && signers[p.keyId]
  if (!publicKey || !verify(null, Buffer.from(JSON.stringify(p)), createPublicKey(publicKey),
    Buffer.from(envelope.signature ?? '', 'base64'))) throw new Error('本地回执缺失、签名无效或签名者未登记。')
  if (p.schema !== 1 || p.repository !== repository || p.head !== head || p.base !== base || p.tree !== tree ||
      p.status !== 'passed' || p.completeCandidate !== false || !Number.isSafeInteger(p.issuedAt) ||
      p.issuedAt > now + 60000 || p.issuedAt < now - 7 * 86400000 || !Array.isArray(p.suites))
    throw new Error('本地回执来源、提交、基线、状态或签发时间无效。')
  if (previousNotesSha !== undefined && p.previousNotesSha !== previousNotesSha) throw new Error('旧回执被重放或回执历史不连续。')
  if (new Set(p.suites.map(s => s.name)).size !== p.suites.length || p.suites.length !== required.length)
    throw new Error('本地回执套件重复或缺项。')
  for (const suite of required) {
    const row = p.suites.find(s => s.name === suite.name)
    if (!row || row.status !== 'passed' || row.definition !== definition(suite) || !/^[a-f0-9]{64}$/.test(row.input ?? '') ||
        !/^[a-f0-9]{64}$/.test(row.reportHash ?? '') || !/^[a-f0-9]{64}$/.test(row.host ?? '') ||
        !/^[a-f0-9]{64}$/.test(row.environmentHash ?? '') || !Number.isSafeInteger(row.completedAt) || row.completedAt <= 0 || row.completedAt > p.issuedAt)
      throw new Error('必需本地专项未验证或定义不符：' + suite.name)
  }
  return { status: 'passed', applicable: true, suites: required.map(s => s.name) }
}

/** Git notes keep receipts outside the App tree. Normal fast-forward publication preserves previous note history. */
export function publishEnvelope(root, remote, envelope, signers = {}) {
  const observed = git(root, 'ls-remote', remote, notesRef).split(/\s/)[0]
  if ((observed || null) !== envelope.payload.previousNotesSha) throw new Error('回执历史已更新，重新核验并签发；不覆盖并发发布。')
  const privateRef = 'refs/notes/ios-local-publish-' + randomUUID()
  let primary
  try {
    if (observed) {
      git(root, 'fetch', '--no-tags', remote, notesRef + ':' + privateRef)
      try {
        const previous = readEnvelope(root, privateRef, envelope.payload.head)
        const { issuedAt: beforeTime, previousNotesSha: beforeParent, ...before } = previous.payload
        const { issuedAt: afterTime, previousNotesSha: afterParent, ...after } = envelope.payload
        const publicKey = signers[previous.payload.keyId]
        const parent = noteParent(root, privateRef, envelope.payload.head)
        if (publicKey && beforeParent === parent && digest(before) === digest(after) && beforeTime <= afterTime && beforeTime >= afterTime - 7 * 86400000 &&
            verify(null, Buffer.from(JSON.stringify(previous.payload)), createPublicKey(publicKey), Buffer.from(previous.signature, 'base64')))
          return { status: 'reused' }
      } catch { /* Missing, malformed or untrusted notes are replaced by the new signed result, never accepted. */ }
    }
    const inputGit = (args, input) => execFileSync('git', args, {
      cwd: root, input, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
    // Keep a flat, owned note tree. Git's automatic fanout must not look like a new receipt version.
    const entries = new Map()
    if (observed) for (const line of git(root, 'ls-tree', privateRef).split('\n').filter(Boolean)) {
      const match = /^100644 blob ([a-f0-9]{40})\t([a-f0-9]{40})$/.exec(line)
      if (!match) throw new Error('回执引用含非受管对象，拒绝覆盖。')
      entries.set(match[2], match[1])
    }
    if (entries.size > 10000) throw new Error('回执引用超过受管上限。')
    entries.set(envelope.payload.head, inputGit(['hash-object', '-w', '--stdin'], JSON.stringify(envelope)))
    const tree = inputGit(['mktree'], [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([head, blob]) => `100644 blob ${blob}\t${head}\n`).join(''))
    const commit = inputGit(['commit-tree', tree, ...(observed ? ['-p', observed] : [])], 'Publish signed local verification result\n')
    git(root, 'update-ref', privateRef, commit)
    // The hook only exempts a notes-only push; mixed source/notes updates still require local validation.
    git(root, 'push', remote, privateRef + ':' + notesRef)
    return { status: 'published' }
  } catch (error) { primary = error; throw error }
  finally {
    try { git(root, 'update-ref', '-d', privateRef) }
    catch (error) { throw primary ? new AggregateError([primary, error], '回执发布及私有引用清理失败') : error }
  }
}

/** Other PRs may update the shared ref; bind the parent of this head's last note change, not the ref tip. */
export function noteParent(root, ref, head) {
  const version = git(root, 'log', '-1', '--format=%H', ref, '--', head)
  if (!version) throw new Error('回执缺少版本历史。')
  const parents = git(root, 'rev-list', '--parents', '-n', '1', version).split(/\s/)
  if (parents.length > 2) throw new Error('回执历史不允许混合合并。')
  return parents[1] ?? null
}

export function readEnvelope(root, ref, head) {
  const text = git(root, 'notes', '--ref=' + ref, 'show', head)
  if (Buffer.byteLength(text) > 65536) throw new Error('本地回执超过 64 KiB。')
  return JSON.parse(text)
}
