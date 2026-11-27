import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { selection } from './ios-debug.mjs'
import { assertNpmSources } from './ios-ci.mjs'
import { swiftCaseInput, ciProducerInput } from './ios-execution-inputs.mjs'
export { swiftCaseInput, caseMeasurement, caseMeasurements, suiteMeasurement } from './ios-execution-inputs.mjs'

const swiftPath = 'app/ios/App/UITests/DictionaryTouchTests.swift'
const requireParser = createRequire(new URL('../../app/package.json', import.meta.url))
let parser

/** Called only after the trusted verifier has published pending for the exact PR identity. */
export function prepareTrustedParser(root, { run = execFileSync, environment = process.env } = {}) {
  assertNpmSources(JSON.parse(fs.readFileSync(path.join(root, 'app/package-lock.json'), 'utf8')))
  const env = { ...environment }
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  run('npm', ['--prefix', 'app', 'ci', '--ignore-scripts'], {
    cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
  })
}

function publicTypeContract(text) {
  parser ??= requireParser('typescript')
  const ts = parser, source = ts.createSourceFile('change.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (source.parseDiagnostics.length) return true
  let protectedType = false
  const visit = node => {
    // Includes separated `interface Props; export default Props` and `export = Props`.
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) protectedType = true
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []
    if (modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword) &&
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node) ||
         ts.isModuleDeclaration(node) || modifiers.some(m => m.kind === ts.SyntaxKind.DeclareKeyword))) protectedType = true
    if (!protectedType) ts.forEachChild(node, visit)
  }
  visit(source)
  return protectedType
}

/** Pure TS erasure is safe for ordinary .ts; Vue macros can derive runtime props from types. */
export function runtimeEquivalent(file, before, after) {
  if (before === null || after === null || !file.endsWith('.ts') || file.endsWith('.d.ts')) return false
  // Exported type contracts may feed a Vue macro in another file. Erasure alone cannot prove those safe.
  try {
    if (publicTypeContract(before) || publicTypeContract(after)) return false
    return stripTypeScriptTypes(before, { mode: 'transform' }) === stripTypeScriptTypes(after, { mode: 'transform' })
  } catch { return false }
}

/** Refine path matches, never remove common checks; unavailable source falls back to all matches. */
export function relevantChange(suite, file, changes) {
  const change = changes?.get(file)
  if (!change || change.before === null || change.after === null) return true
  if (runtimeEquivalent(file, change.before, change.after)) return false
  if (file === 'scripts/lib/ios-ci-run.mjs' && suite.kind === 'environment')
    return ciProducerInput(change.before) !== ciProducerInput(change.after)
  if (file === swiftPath) {
    if (suite.kind === 'full' && suite.mode === 'ios-smoke') return false
    if (suite.kind === 'ui') return selection(suite.case ? '--case' : '--scenario', suite.case ?? suite.scenario, []).cases
      .some(id => swiftCaseInput(change.before, id.split('/').at(-1)) !== swiftCaseInput(change.after, id.split('/').at(-1)))
  }
  return true
}

