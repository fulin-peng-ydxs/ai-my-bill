import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** 只对确定的验证工具改动缩小范围；App/构建依赖变化、未知基线和手动候选均保留完整门禁。 */
export function ciValidationScope(files, manual = false) {
  const scriptsOnly = files.length > 0 && files.every(file =>
    (file.startsWith('scripts/') || file.startsWith('agent-works/') ||
      ['README.md', 'AGENTS.md', 'CLAUDE.md', '.github/workflows/offline-ios.yml'].includes(file)) &&
    !['scripts/toolchain.sh', 'scripts/normalize-capacitor-spm.mjs'].includes(file))
  return !manual && scriptsOnly ? { common: 'scripts', native: false } : { common: 'app', native: true }
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
  const scope = ciValidationScope(files, process.env.GITHUB_EVENT_NAME === 'workflow_dispatch')
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `common=${scope.common}\nnative=${scope.native}\n`)
  console.log(JSON.stringify(scope))
}
