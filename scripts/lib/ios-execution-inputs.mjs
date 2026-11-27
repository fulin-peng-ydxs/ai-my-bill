import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { generated } from './ios-cache.mjs'
import { selection } from './ios-debug.mjs'
import { compatibilityProducerPinsDigest } from './ios-execution-compat-policy.mjs'
import { scopedSource, interactionCase, legacyProducerSource, isolatedInteraction } from './ios-scenario-dependencies.mjs'

const scopedPolicySha = 'd9836315f57faecc7aa4bcfb677aa71a1b3ed11751390c73d60a185df18d54c2'
const scopedPolicyPath = 'scripts/lib/ios-scenario-dependencies.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const swiftPath = 'app/ios/App/UITests/DictionaryTouchTests.swift'
// Strip comments and quoted literals only for brace discovery. Original bodies remain hashed.
function maskSwift(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"/g,
    part => part.replace(/[^\n]/g, ' '))
}

/** Unknown declarations, imports and shared setup remain part of every case. */
export function swiftCaseInput(text, name) {
  const masked = maskSwift(text), methods = new Map(), spans = []
  const re = /\b(?:(?:private|override|public|fileprivate|static|class)\s+)*func\s+(\w+)\s*\([^{}]*?\)\s*(?:throws\s*)?(?:->[^{}]+)?\{/g
  let match
  while ((match = re.exec(masked))) {
    let depth = 1, end = re.lastIndex
    for (; end < masked.length && depth; end++) {
      if (masked[end] === '{') depth++
      if (masked[end] === '}') depth--
    }
    if (depth || methods.has(match[1])) return hash(text)
    methods.set(match[1], { raw: text.slice(match.index, end), masked: masked.slice(re.lastIndex, end) })
    spans.push([match.index, end]); re.lastIndex = end
  }
  if (!methods.has(name)) return hash(text)
  let outside = '', previous = 0
  for (const [start, end] of spans) { outside += text.slice(previous, start); previous = end }
  outside += text.slice(previous)
  const reached = new Set()
  const visit = method => {
    if (reached.has(method) || !methods.has(method)) return
    reached.add(method)
    // Include function values and string interpolation, not only direct calls.
    for (const reference of methods.get(method).raw.matchAll(/\b(\w+)\b/g)) visit(reference[1])
  }
  for (const method of [name, 'setUp', 'tearDown', 'setUpWithError', 'tearDownWithError']) visit(method)
  for (const reference of outside.matchAll(/\b(\w+)\b/g)) visit(reference[1])
  return hash([outside, [...reached].sort().map(k => [k, methods.get(k).raw])])
}


const consumerAliases = ['scripts/lib/ios-local-partials.mjs', 'scripts/lib/ios-measurement-scope.mjs']
const ciProducerPath = 'scripts/lib/ios-ci-run.mjs'
const verificationPath = 'scripts/lib/ios-verification.mjs'
const legacyPaths = [...consumerAliases, ciProducerPath, verificationPath]
const producerPaths = ['scripts/lib/ios-local-measurement.mjs', 'scripts/lib/ios-execution-inputs.mjs']
const compatibilityPath = 'config/ios-measurement-v1.json'
const legacySourceDigest = 'f9a8fca50bf041da81a5ea06f934fcfb9c54811318e42e3bc434aac2072f75cf'
const bytes = file => {
  if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) throw new Error('执行输入兼容材料必须为普通文件。')
  return fs.readFileSync(file)
}

/** One immutable v1 encoding bridge, only while both extracted producers are byte-identical.
 * Old source text is data, never imported/executed; producer drift switches to v2 and invalidates v1.
 * Consumer edits cannot refresh a report, clear a failure or substitute for any original evidence.
 */
function legacyProjection(root, inputs) {
  const file = path.join(root, compatibilityPath)
  if (!fs.existsSync(file)) return undefined
  const raw = bytes(file)
  if (raw.length > 131072) throw new Error('执行输入兼容材料过大。')
  const policy = JSON.parse(raw)
  if (policy.schema !== 1 || JSON.stringify(Object.keys(policy.sources ?? {}).sort()) !== JSON.stringify([...legacyPaths].sort()) ||
      JSON.stringify(Object.keys(policy.producerPins ?? {}).sort()) !== JSON.stringify([...producerPaths].sort()))
    throw new Error('执行输入兼容契约无效。')
  if (hash(policy.producerPins) !== compatibilityProducerPinsDigest)
    throw new Error('执行生产者固定摘要被修改，不能重设兼容白名单。')
  const digest = createHash('sha256')
  for (const relative of [...legacyPaths].sort()) {
    const source = policy.sources[relative]
    if (typeof source.content !== 'string' || createHash('sha256').update(source.content).digest('hex') !== source.sha256)
      throw new Error('旧执行输入编码材料损坏。')
    digest.update(relative + '\0' + source.content + '\0')
  }
  if (digest.digest('hex') !== legacySourceDigest) throw new Error('旧执行输入编码不属于已核实的 v1 基线。')
  for (const relative of producerPaths) {
    const producer = path.join(root, relative)
    if (!fs.existsSync(producer)) return undefined
    const raw = bytes(producer), sha = value => createHash('sha256').update(value).digest('hex')
    if (sha(raw) !== policy.producerPins[relative]) {
      const original = trustedScopePolicy(root) && legacyProducerSource(relative, raw.toString('utf8'))
      if (!original || sha(original) !== policy.producerPins[relative]) return undefined
    }
  }
  const oldCiSource = policy.sources[ciProducerPath].content
  const boundary = oldCiSource.indexOf('\n/** 逐份核实原报告')
  if (boundary < 0) throw new Error('旧 CI 生产者边界缺失。')
  if (inputs.includes(ciProducerPath) && !ciProducerBytes(root).equals(Buffer.from(oldCiSource.slice(0, boundary)))) return undefined
  if (inputs.includes(verificationPath) && verificationProducerInput(bytes(path.join(root, verificationPath)).toString('utf8')) !==
      verificationProducerInput(policy.sources[verificationPath].content)) return undefined
  return policy.sources
}

// Everything above this boundary issues commands/collects their artifacts. Unknown layouts remain fully bound.
export function ciProducerInput(source) {
  const marker = '\n// CI_CONSUMER_BOUNDARY:'
  const end = source.indexOf(marker)
  if (end < 0 || source.indexOf(marker, end + marker.length) >= 0) return source
  const producer = source.slice(0, end), consumer = source.slice(end)
  if (!producer.includes('export async function executeGroup(') || !producer.endsWith('  if (error) throw error\n}\n')) return source
  // validateReports is the existing post-execution reader. Any other late command helper
  // makes this boundary unknown, so bind the whole file instead of dropping its implementation.
  for (const [, name] of consumer.matchAll(/\b(?:async\s+)?function\s+(\w+)\s*\(/g))
    if (name !== 'validateReports' && new RegExp('\\b' + name + '\\b').test(producer)) return source
  return producer
}
const requireParser = createRequire(new URL('../../app/package.json', import.meta.url))
let parser
const verificationCache = new Map()

/** Keep all producer statements, including unexpected top-level code; erase only the two known readers.
 * A missing parser/unknown syntax binds the whole file rather than guessing equivalence.
 */
export function verificationProducerInput(source) {
  const key = hash(source)
  if (verificationCache.has(key)) return verificationCache.get(key)
  let projected = source
  try {
    parser ??= requireParser('typescript')
    const ts = parser, parsed = ts.createSourceFile('verification.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    if (parsed.parseDiagnostics.length) return source
    const ignored = new Set(['requireEvidence', 'requireEvidenceSet', 'readEvidenceResult'])
    projected = parsed.statements.filter(node => {
      if (ts.isFunctionDeclaration(node) && ignored.has(node.name?.text)) return false
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === './ios-local-partials.mjs') {
        const bindings = node.importClause?.namedBindings
        if (!node.importClause.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length === 1 &&
            bindings.elements[0].getText(parsed) === 'validateLocalPartial') return false
      }
      return true
    }).map(node => node.getText(parsed)).join('\n')
  } catch { /* Fail closed for old evidence; a clean checkout follows the normal bootstrap prerequisite. */ }
  if (verificationCache.size >= 32) verificationCache.clear()
  verificationCache.set(key, projected)
  return projected
}

function ciProducerBytes(root) {
  return Buffer.from(ciProducerInput(bytes(path.join(root, ciProducerPath)).toString('utf8')))
}

const common = ['.nvmrc', 'app/package.json', 'app/package-lock.json', 'app/capacitor.config.ts',
  'app/tsconfig.json', 'app/tsconfig.tools.json', 'app/vite.config.ts', 'scripts/toolchain.sh',
  'scripts/ios-app.mjs', 'scripts/ios-app.sh', 'scripts/lib/ios-app-full.sh',
  'scripts/lib/ios-cache.mjs', 'scripts/lib/ios-debug.mjs', 'scripts/lib/ios-verification.mjs',
  'scripts/lib/ios-local-partials.mjs', 'scripts/lib/ios-checks.mjs', 'scripts/lib/ios-errors.mjs', 'scripts/lib/ios-boot-proof.mjs',
  'scripts/lib/ios-test-reports.mjs',
  'scripts/lib/ios-processes.mjs', 'scripts/lib/ios-process-scope.mjs', 'scripts/lib/ios-host-diagnostics.py',
  'scripts/lib/ios-process-launch.mjs', 'scripts/lib/ios-process-launch.sh', 'scripts/lib/ios-capacity.mjs', 'scripts/lib/ios-scale-run.mjs',
  'scripts/lib/ios-scenario-evidence.mjs', 'scripts/lib/ios-coverage.mjs',
  'scripts/lib/ios-simctl.mjs', 'scripts/lib/ios-simctl-sync.mjs', 'scripts/lib/ios-measurement-scope.mjs']

/** An unknown dependency policy is fully bound; it cannot normalise an old execution. */
function trustedScopePolicy(root) {
  const file = path.join(root, scopedPolicyPath)
  return fs.existsSync(file) && createHash('sha256').update(bytes(file)).digest('hex') === scopedPolicySha
}

function filesInput(root, inputs, omit = () => false, interaction = false) {
  const trusted = trustedScopePolicy(root), isolated = trusted && isolatedInteraction(root)
  const projection = legacyProjection(root, inputs), rows = []
  const visit = relative => {
    if (generated(relative) || relative.split('/').includes('__pycache__') || omit(relative)) return
    if (isolated && !interaction && relative === 'scripts/fixtures/ios_interaction.py') return
    const file = path.join(root, relative)
    let stat
    try { stat = fs.lstatSync(file) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      rows.push([relative, 'missing']); return
    }
    if (stat.isSymbolicLink()) throw new Error('测量输入不能使用符号链接：' + relative)
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(relative + '/' + name)
    else if (stat.isFile()) {
      const raw = projection?.[relative] ? Buffer.from(projection[relative].content) : relative === ciProducerPath ? ciProducerBytes(root)
        : relative === verificationPath ? Buffer.from(verificationProducerInput(fs.readFileSync(file, 'utf8'))) : fs.readFileSync(file)
      rows.push([relative, stat.mode & 0o111, (trusted ? scopedSource(relative, raw, interaction) : raw).toString('base64')])
    }
    else throw new Error('测量输入不是普通文件：' + relative)
  }
  const selected = projection ? inputs : [...inputs.filter(file => !consumerAliases.includes(file)), ...producerPaths, compatibilityPath, scopedPolicyPath]
  ;[...new Set(selected)].sort().forEach(visit)
  return projection ? hash(rows) : hash([2, rows])
}

/** Runtime execution scopes exclude tool regression sources, documentation and routing policy. */
function uiExecutionInput(root, interaction = false) {
  return filesInput(root, [...common, 'app/src', 'app/index.html', 'app/public',
    'app/test-support', 'app/ios/App',
    'scripts/fixtures', 'scripts/normalize-capacitor-spm.mjs',
    'scripts/verify-ios-resources.mjs', 'scripts/ios-storage-policy.mjs'],
  file => /\.spec\.ts$/.test(file) || file === swiftPath ||
    (file.startsWith('app/ios/App/NativeTests/') && !file.endsWith('/OwnedSimulatorTestContext.swift')) || file.startsWith('app/ios/App/CapacityTests/'), interaction)
}

export function caseMeasurement(root, id, execution) {
  if (id.startsWith('NativeTests/')) return hash([1, id, suiteMeasurement(root, { kind: 'full', mode: 'ios-smoke' })])
  execution ??= uiExecutionInput(root, interactionCase(id))
  return hash([1, execution, id, swiftCaseInput(fs.readFileSync(path.join(root, swiftPath), 'utf8'), id.split('/').at(-1))])
}

export function caseMeasurements(root, ids) {
  const scopes = new Map()
  return Object.fromEntries(ids.map(id => {
    const key = interactionCase(id)
    if (!id.startsWith('NativeTests/') && !scopes.has(key)) scopes.set(key, uiExecutionInput(root, key))
    return [id, caseMeasurement(root, id, scopes.get(key))]
  }))
}

export function suiteMeasurement(root, suite) {
  if (suite.kind === 'ui') return hash([1, suite.case ?? suite.scenario,
    caseMeasurements(root, selection(suite.case ? '--case' : '--scenario', suite.case ?? suite.scenario, []).cases)])
  const inputs = suite.kind === 'environment'
    ? [...common, 'scripts/lib/ios-boot-proof.mjs']
    : [...common, 'app/src', 'app/public', 'app/index.html', 'app/ios/App', 'app/native-tests',
      'app/test-support', 'app/vitest.config.ts', 'scripts/fixtures', 'scripts/lib/ios-ci-run.mjs',
      'scripts/verify-ios-resources.mjs', 'scripts/normalize-capacitor-spm.mjs', 'scripts/ios-storage-policy.mjs']
  return filesInput(root, inputs, file => /\.spec\.ts$/.test(file) || file.startsWith('app/ios/App/UITests/'))
}
