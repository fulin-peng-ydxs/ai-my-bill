import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { assertPlan, remoteSuite } from './ios-ci-plan.mjs'
import { resultsDirectory, reconcile } from './ios-ci-run.mjs'
import { errorMessage } from './ios-errors.mjs'
import { writeJson } from './ios-verification.mjs'

/** Match complete registered local suites, re-reading original evidence through the existing reconciler. */
export function localGate(root, directory, input) {
  const report = { schema: 1, status: 'incomplete', completeCandidate: false, scope: 'required-local-checks', suites: [] }
  try {
    const read = file => {
      if (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file) throw new Error('本地核验输入必须为普通文件。')
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    }
    const plan = assertPlan(root, read(path.join(directory, 'ci-plan.json')))
    if (!['change', 'pull-request'].includes(plan.profile)) throw new Error('本地核验须使用按变更计划。')
    report.plan = plan.id
    report.source = plan.source
    const required = plan.execution === 'remote' ? plan.localRequired : plan.suites.filter(s => !remoteSuite(s))
    const paths = read(path.resolve(root, input))
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string')) throw new Error('本地证据清单必须为结果目录数组。')
    const directories = paths.map(p => resultsDirectory(root, p))
    if (new Set(directories).size !== directories.length || directories.includes(directory)) throw new Error('本地证据目录重复或引用自身。')
    const definitions = new Map()
    for (const evidence of directories) {
      const candidate = assertPlan(root, read(path.join(evidence, 'ci-plan.json')))
      if (candidate.execution !== 'local' || !isDeepStrictEqual(candidate.source, plan.source)) throw new Error('证据必须来自同源码的本地执行。')
      const actual = reconcile(root, evidence)
      if (actual.status !== 'passed') throw new Error('本地证据缺项、失败、取消或清理未通过：' + path.basename(evidence))
      for (const suite of candidate.suites) {
        const { reasons, ...definition } = suite
        definitions.set(suite.name, { definition, directory: path.relative(root, evidence) })
      }
    }
    for (const suite of required) {
      const { reasons, ...definition } = suite
      const actual = definitions.get(suite.name)
      const passed = actual && isDeepStrictEqual(actual.definition, definition)
      report.suites.push({ suite: suite.name, status: passed ? 'passed' : 'not-verified', evidence: actual?.directory })
    }
    if (report.suites.some(s => s.status !== 'passed')) throw new Error('必需本地专项证据缺失或定义不符。')
    // Local readiness does not unlock a previous full failure or certify a final/device candidate.
    report.status = 'passed'
  } catch (error) {
    report.error = errorMessage(error)
  }
  // Keep each failed check, while replacing the latest summary so an old green cannot survive failure.
  writeJson(path.join(directory, 'local-readiness-' + randomUUID() + '.json'), report)
  writeJson(path.join(directory, 'local-readiness.json'), report)
  return report
}
