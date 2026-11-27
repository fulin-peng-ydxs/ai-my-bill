import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { assertPlan, remoteSuite, digest } from './ios-ci-plan.mjs'
import { resultsDirectory, validateSuiteEvidence } from './ios-ci-run.mjs'
import { errorMessage } from './ios-errors.mjs'
import { writeJson } from './ios-verification.mjs'
import { nativeEnvironment } from './ios-evidence-inputs.mjs'
import { aggregatePartials, partialRuns, partialFailureStatus } from './ios-local-partials.mjs'

/** Match complete registered local suites, re-reading original evidence through the existing reconciler. */
export function localGate(root, directory, input, { reuse = false, readEnvironment = nativeEnvironment, barriers = {} } = {}) {
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
    const snapshot = reuse && required.length ? partialRuns(root) : { rows: [], errors: [], legacyFailures: [] }
    const partials = snapshot.rows
    if (snapshot.errors.length) report.isolatedEvidence = snapshot.errors
    const environment = reuse && required.length && (directories.length || partials.length || snapshot.legacyFailures.length) ? readEnvironment() : undefined
    if (new Set(directories).size !== directories.length || directories.includes(directory)) throw new Error('本地证据目录重复或引用自身。')
    const definitions = new Map()
    for (const evidence of directories) {
      try {
        const candidate = read(path.join(evidence, 'ci-plan.json'))
        if (!reuse) assertPlan(root, candidate)
        if (candidate.execution !== 'local' || (!reuse && !isDeepStrictEqual(candidate.source, plan.source))) throw new Error('证据必须来自同源码的本地执行。')
        for (const suite of candidate.suites.filter(s => required.some(r => r.name === s.name))) {
          try {
            validateSuiteEvidence(root, evidence, candidate, suite, { reuse })
            const { reasons, ...definition } = suite
            const receipt = read(path.join(evidence, suite.name, 'receipt.json'))
            let environmentHash
            if (environment) {
              const primary = receipt.reports.find(r => r.primary && r.role === 'primary')
              const actual = suite.kind === 'environment'
                ? JSON.parse(read(path.join(evidence, suite.name, 'environment.json')).readiness.environment)
                : primary && JSON.parse(read(path.join(evidence, suite.name, primary.path)).environment)
              if (!isDeepStrictEqual(actual, environment)) throw new Error('本地证据 Xcode/SDK/runtime 工具链已失效。')
              environmentHash = digest(actual)
            }
            if (receipt.startedAt <= (barriers[suite.name] ?? 0)) throw new Error('旧成功不能覆盖后续失败。')
            const primary = receipt.reports.find(r => r.primary && r.role === 'primary')
            const original = primary && read(path.join(evidence,suite.name,primary.path))
            const stageProofs = Object.fromEntries((original?.timings ?? []).filter(t=>t.status==='passed')
              .flatMap(t=>(t.coverage ?? []).filter(key=>original.coverage?.includes(key))
                .map(key=>[key,t.startedAt])))
            definitions.set(suite.name, { definition, directory: path.relative(root, evidence),
              stageProofs,
              measuredSource: candidate.source, measurementInput: candidate.measurementScopes?.[suite.name] ?? candidate.measurementInput,
              startedAt: receipt.startedAt, completedAt: receipt.completedAt, reportHash: digest(receipt), host: receipt.measurementHost, environmentHash })
          } catch (error) {
            if (!reuse) throw error
            report.errors ??= []
            report.errors.push({ evidence: path.relative(root, evidence), suite: suite.name, error: errorMessage(error) })
          }
        }
      } catch (error) {
        if (!reuse) throw error
        report.errors ??= []
        report.errors.push({ evidence: path.relative(root, evidence), error: errorMessage(error) })
      }
    }
    for (const suite of required) {
      const { reasons, ...definition } = suite
      const actual = definitions.get(suite.name)
      const partial = aggregatePartials(root, suite, environment ?? { unverified: true },
        environment ? partials : [], barriers[suite.name],snapshot.caseInputs)
      const failure = partialFailureStatus(root, suite, environment ?? { unverified: true },
        environment ? snapshot : { rows: [], legacyFailures: [] })
      const passed = actual && isDeepStrictEqual(actual.definition, definition) &&
        !Object.entries(failure.failureTimes).some(([target,time]) => target.startsWith('case/')
          ? time >= actual.startedAt : !(actual.stageProofs?.[target] > time))
      if (partial?.status === 'passed') {
        const blocked = Object.entries(failure.failureTimes).filter(([target, time]) =>
          !target.startsWith('case/') || partial.proofs.some(proof => target === 'case/' + proof.id && proof.startedAt <= time))
        if (blocked.length) {
          partial.status = 'not-verified'
          partial.missingCases = [...new Set(blocked.flatMap(([target]) => target.startsWith('case/')
            ? [target.slice(5)] : partial.proofs.map(proof => proof.id)))]
        }
      }
      report.suites.push(passed ? { suite: suite.name, status: 'passed', ...actual, repairs: failure.repairs,
        reportHash: failure.repairs.length ? digest([actual.reportHash, failure.repairs]) : actual.reportHash,
        completedAt: Math.max(actual.completedAt, ...failure.repairs.map(r => r.completedAt)) }
        : { suite: suite.name, status: 'not-verified', ...partial, blockedBy: failure.failureTimes })
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
