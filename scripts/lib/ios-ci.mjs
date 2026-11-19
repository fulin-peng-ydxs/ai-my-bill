import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** 只对确定的验证工具改动缩小范围；App/构建依赖变化、未知基线和手动候选均保留完整门禁。 */
export function ciValidationScope(files, manual = false, baselineVerified = false) {
  const scriptsOnly = files.length > 0 && files.every(file =>
    (file.startsWith('scripts/') || file.startsWith('agent-works/') ||
      ['README.md', 'AGENTS.md', 'CLAUDE.md', '.github/workflows/offline-ios.yml'].includes(file)) &&
    !['scripts/toolchain.sh', 'scripts/normalize-capacitor-spm.mjs'].includes(file))
  return !manual && scriptsOnly && baselineVerified
    ? { common: 'scripts', native: false } : { common: 'app', native: true }
}

export const baselineJob = 'app-baseline-v1'

/**
 * 只信任基线 SHA 最新运行/最新 attempt 的成功基线，不能让旧绿色遮住后来的失败或取消。
 * 标记由 workflow 依赖结果产生，支持脚本提交链；旧版本仅接受明确完成的 App/原生完整 job。
 * REST：docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt
 */
export async function verifiedBaseline(base, env = process.env, request = fetch) {
  if (!/^[a-f0-9]{40}$/i.test(base ?? '') || /^0+$/.test(base) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? '') || !env.GH_TOKEN)
    return false
  let api
  try { api = new URL(env.GITHUB_API_URL ?? 'https://api.github.com') } catch { return false }
  if (api.protocol !== 'https:') return false
  const prefix = `${api.href.replace(/\/$/, '')}/repos/${env.GITHUB_REPOSITORY}/actions`
  const signal = AbortSignal.timeout(20_000)
  const get = async url => {
    const response = await request(url, { signal, redirect: 'error', headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GH_TOKEN}`,
      'X-GitHub-Api-Version': '2026-03-10'
    } })
    if (!response.ok) throw new Error('CI 基线查询未成功')
    return response.json()
  }
  try {
    const data = await get(`${prefix}/workflows/offline-ios.yml/runs?head_sha=${base}&per_page=100`)
    if (data.total_count > data.workflow_runs?.length) return false
    const run = (data.workflow_runs ?? []).filter(r => r.head_sha === base)
      .sort((a, b) => {
        // 老 run 的新 attempt 可能比新 run 更晚失败，不能只按创建 ID 排序。
        const updated = Date.parse(b.updated_at) - Date.parse(a.updated_at)
        return (Number.isFinite(updated) && updated !== 0 ? updated : 0) ||
          Number(a.conclusion === 'success') - Number(b.conclusion === 'success') || b.id - a.id
      })[0]
    if (run?.status !== 'completed' || run.conclusion !== 'success' ||
      !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1)
      return false
    const result = await get(`${prefix}/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)
    if (result.total_count > result.jobs?.length) return false
    const jobs = (result.jobs ?? []).filter(j => j.name === baselineJob)
    if (jobs.length) return jobs.length === 1 && jobs[0].status === 'completed' && jobs[0].conclusion === 'success'
    // 初始基线可来自旧版本的真实完整通过；旧版仅脚本绿色（native skipped）不能继承。
    return ['app-common', 'native-simulator'].every(name => {
      const full = (result.jobs ?? []).filter(j => j.name === name)
      return full.length === 1 && full[0].status === 'completed' && full[0].conclusion === 'success'
    })
  } catch {
    // API 不可达/限流/取消只扩大验证，不输出 token 或错误响应内容。
    console.warn('无法确认已通过的 CI 基线，保留完整门禁。')
    return false
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const base = event.pull_request?.base?.sha ?? event.before
  // 新分支、浅历史或未知事件不猜变更范围，保守进入完整门禁。
  let files = []
  if (/^[a-f0-9]{40}$/i.test(base ?? '') && !/^0+$/.test(base)) {
    try {
      files = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        .split('\0').filter(Boolean)
    } catch {
      console.warn('无法核实 Git 基线，保留完整门禁。')
    }
  }
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? '1')
  // scope 被重新执行时，不沿用父提交绿色来跳过本提交上一 attempt 的失败。
  const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ||
    !Number.isSafeInteger(attempt) || attempt !== 1
  const candidate = ciValidationScope(files, manual, true)
  const passed = !candidate.native && await verifiedBaseline(base)
  const scope = ciValidationScope(files, manual, passed)
  const reason = candidate.native ? 'app-input-manual-or-unknown-range'
    : passed ? 'verified-baseline' : 'baseline-unverified'
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `common=${scope.common}\nnative=${scope.native}\nbaseline=${passed}\n`)
  console.log(JSON.stringify({ ...scope, baselineVerified: passed, reason }))
}
