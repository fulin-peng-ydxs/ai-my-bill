import fs from 'node:fs'
import path from 'node:path'

// A bounded compatibility projection, not permission to refresh an old report or producer pin.
// Only the exact isolated interaction addition and the reviewed measurement/reader refactor
// can be reversed. Unknown edits remain byte-bound and cannot reuse v1 evidence.
const selectorBranch = "  if (indices.every(index => index >= 61)) return { scheme:'DictionaryTouch',configuration:'Release',\n    fixture:'interaction-'+indices.join(','),\n    cases:indices.map(index => 'DictionaryUITests/DictionaryTouchTests/'+uiCases[index]) }"
const originalSelectorBranch = "  if (indices.every(index => index >= 61)) return { scheme:'DictionaryTouch',configuration:'Release',\n    cases:indices.map(index => 'DictionaryUITests/DictionaryTouchTests/'+uiCases[index]) }"
const dispatcherBranch = "interaction_match = re.fullmatch(r'debug-(check-)?interaction-((?:6[1-3])(?:,6[1-3])*)', mode)\nif interaction_match:\n    # 专用协议只读捕获空账本及回读真实草稿，不预写页面待验结果。\n    from ios_interaction import run\n    run(bool(interaction_match[1]), Path(container), simulator_id, Path(receipt_file),\n        [int(case) for case in interaction_match[2].split(',')])\n    sys.exit(0)\n"
const legacyChanges = {
  "scripts/lib/ios-execution-inputs.mjs": [
    [
      "import { selection } from './ios-debug.mjs'\nimport { compatibilityProducerPinsDigest } from './ios-execution-compat-policy.mjs'\n\nconst hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')\n",
      "import { selection } from './ios-debug.mjs'\nimport { compatibilityProducerPinsDigest } from './ios-execution-compat-policy.mjs'\nimport { scopedSource, interactionCase, legacyProducerSource, isolatedInteraction } from './ios-scenario-dependencies.mjs'\n\nconst scopedPolicySha = 'SCOPED_POLICY_SHA'\nconst scopedPolicyPath = 'scripts/lib/ios-scenario-dependencies.mjs'\n\nconst hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')\n"
    ],
    [
      "  for (const relative of producerPaths) {\n    const producer = path.join(root, relative)\n    if (!fs.existsSync(producer) || createHash('sha256').update(bytes(producer)).digest('hex') !== policy.producerPins[relative]) return undefined\n  }\n  const oldCiSource = policy.sources[ciProducerPath].content\n",
      "  for (const relative of producerPaths) {\n    const producer = path.join(root, relative)\n    if (!fs.existsSync(producer)) return undefined\n    const raw = bytes(producer), sha = value => createHash('sha256').update(value).digest('hex')\n    if (sha(raw) !== policy.producerPins[relative]) {\n      const original = trustedScopePolicy(root) && legacyProducerSource(relative, raw.toString('utf8'))\n      if (!original || sha(original) !== policy.producerPins[relative]) return undefined\n    }\n  }\n  const oldCiSource = policy.sources[ciProducerPath].content\n"
    ],
    [
      "    const ts = parser, parsed = ts.createSourceFile('verification.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)\n    if (parsed.parseDiagnostics.length) return source\n    const ignored = new Set(['requireEvidence', 'requireEvidenceSet'])\n    projected = parsed.statements.filter(node => {\n      if (ts.isFunctionDeclaration(node) && ignored.has(node.name?.text)) return false\n",
      "    const ts = parser, parsed = ts.createSourceFile('verification.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)\n    if (parsed.parseDiagnostics.length) return source\n    const ignored = new Set(['requireEvidence', 'requireEvidenceSet', 'readEvidenceResult'])\n    projected = parsed.statements.filter(node => {\n      if (ts.isFunctionDeclaration(node) && ignored.has(node.name?.text)) return false\n"
    ],
    [
      "  'scripts/lib/ios-simctl.mjs', 'scripts/lib/ios-simctl-sync.mjs', 'scripts/lib/ios-measurement-scope.mjs']\n\nfunction filesInput(root, inputs, omit = () => false) {\n  const projection = legacyProjection(root, inputs), rows = []\n  const visit = relative => {\n    if (generated(relative) || relative.split('/').includes('__pycache__') || omit(relative)) return\n    const file = path.join(root, relative)\n    let stat\n",
      "  'scripts/lib/ios-simctl.mjs', 'scripts/lib/ios-simctl-sync.mjs', 'scripts/lib/ios-measurement-scope.mjs']\n\n/** An unknown dependency policy is fully bound; it cannot normalise an old execution. */\nfunction trustedScopePolicy(root) {\n  const file = path.join(root, scopedPolicyPath)\n  return fs.existsSync(file) && createHash('sha256').update(bytes(file)).digest('hex') === scopedPolicySha\n}\n\nfunction filesInput(root, inputs, omit = () => false, interaction = false) {\n  const trusted = trustedScopePolicy(root), isolated = trusted && isolatedInteraction(root)\n  const projection = legacyProjection(root, inputs), rows = []\n  const visit = relative => {\n    if (generated(relative) || relative.split('/').includes('__pycache__') || omit(relative)) return\n    if (isolated && !interaction && relative === 'scripts/fixtures/ios_interaction.py') return\n    const file = path.join(root, relative)\n    let stat\n"
    ],
    [
      "    if (stat.isSymbolicLink()) throw new Error('测量输入不能使用符号链接：' + relative)\n    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(relative + '/' + name)\n    else if (stat.isFile()) rows.push([relative, stat.mode & 0o111, (projection?.[relative] ? Buffer.from(projection[relative].content) : relative === ciProducerPath ? ciProducerBytes(root) : relative === verificationPath ? Buffer.from(verificationProducerInput(fs.readFileSync(file, 'utf8'))) : fs.readFileSync(file)).toString('base64')])\n    else throw new Error('测量输入不是普通文件：' + relative)\n  }\n  const selected = projection ? inputs : [...inputs.filter(file => !consumerAliases.includes(file)), ...producerPaths, compatibilityPath]\n  ;[...new Set(selected)].sort().forEach(visit)\n  return projection ? hash(rows) : hash([2, rows])\n",
      "    if (stat.isSymbolicLink()) throw new Error('测量输入不能使用符号链接：' + relative)\n    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(relative + '/' + name)\n    else if (stat.isFile()) {\n      const raw = projection?.[relative] ? Buffer.from(projection[relative].content) : relative === ciProducerPath ? ciProducerBytes(root)\n        : relative === verificationPath ? Buffer.from(verificationProducerInput(fs.readFileSync(file, 'utf8'))) : fs.readFileSync(file)\n      rows.push([relative, stat.mode & 0o111, (trusted ? scopedSource(relative, raw, interaction) : raw).toString('base64')])\n    }\n    else throw new Error('测量输入不是普通文件：' + relative)\n  }\n  const selected = projection ? inputs : [...inputs.filter(file => !consumerAliases.includes(file)), ...producerPaths, compatibilityPath, scopedPolicyPath]\n  ;[...new Set(selected)].sort().forEach(visit)\n  return projection ? hash(rows) : hash([2, rows])\n"
    ],
    [
      "\n/** Runtime execution scopes exclude tool regression sources, documentation and routing policy. */\nfunction uiExecutionInput(root) {\n  return filesInput(root, [...common, 'app/src', 'app/index.html', 'app/public',\n    'app/test-support', 'app/ios/App',\n",
      "\n/** Runtime execution scopes exclude tool regression sources, documentation and routing policy. */\nfunction uiExecutionInput(root, interaction = false) {\n  return filesInput(root, [...common, 'app/src', 'app/index.html', 'app/public',\n    'app/test-support', 'app/ios/App',\n"
    ],
    [
      "    'scripts/verify-ios-resources.mjs', 'scripts/ios-storage-policy.mjs'],\n  file => /\\.spec\\.ts$/.test(file) || file === swiftPath ||\n    (file.startsWith('app/ios/App/NativeTests/') && !file.endsWith('/OwnedSimulatorTestContext.swift')) || file.startsWith('app/ios/App/CapacityTests/'))\n}\n\nexport function caseMeasurement(root, id, execution) {\n  if (id.startsWith('NativeTests/')) return hash([1, id, suiteMeasurement(root, { kind: 'full', mode: 'ios-smoke' })])\n  execution ??= uiExecutionInput(root)\n  return hash([1, execution, id, swiftCaseInput(fs.readFileSync(path.join(root, swiftPath), 'utf8'), id.split('/').at(-1))])\n}\n\nexport function caseMeasurements(root, ids) {\n  const execution = ids.some(id => !id.startsWith('NativeTests/')) ? uiExecutionInput(root) : undefined\n  return Object.fromEntries(ids.map(id => [id, caseMeasurement(root, id, execution)]))\n}\n\n",
      "    'scripts/verify-ios-resources.mjs', 'scripts/ios-storage-policy.mjs'],\n  file => /\\.spec\\.ts$/.test(file) || file === swiftPath ||\n    (file.startsWith('app/ios/App/NativeTests/') && !file.endsWith('/OwnedSimulatorTestContext.swift')) || file.startsWith('app/ios/App/CapacityTests/'), interaction)\n}\n\nexport function caseMeasurement(root, id, execution) {\n  if (id.startsWith('NativeTests/')) return hash([1, id, suiteMeasurement(root, { kind: 'full', mode: 'ios-smoke' })])\n  execution ??= uiExecutionInput(root, interactionCase(id))\n  return hash([1, execution, id, swiftCaseInput(fs.readFileSync(path.join(root, swiftPath), 'utf8'), id.split('/').at(-1))])\n}\n\nexport function caseMeasurements(root, ids) {\n  const scopes = new Map()\n  return Object.fromEntries(ids.map(id => {\n    const key = interactionCase(id)\n    if (!id.startsWith('NativeTests/') && !scopes.has(key)) scopes.set(key, uiExecutionInput(root, key))\n    return [id, caseMeasurement(root, id, scopes.get(key))]\n  }))\n}\n\n"
    ]
  ],
  "scripts/lib/ios-local-measurement.mjs": [
    [
      "import { caseMeasurements } from './ios-execution-inputs.mjs'\nimport { readState, writeJson, evidenceRoot } from './ios-verification.mjs'\n\n// Execution-side registration and sealing. Consumer-only checks live in ios-local-partials.\n",
      "import { caseMeasurements } from './ios-execution-inputs.mjs'\nimport { readState, writeJson, evidenceRoot } from './ios-verification.mjs'\nimport { assertUiReadback, assertUiInteractionLog } from './ios-ui-readback.mjs'\n\n// Execution-side registration and sealing. Consumer-only checks live in ios-local-partials.\n"
    ],
    [
      "  if (selected.cases.some(id => measured.cases[id] !== current[id]))\n    throw new Error('执行期间相关测量输入变化，局部结果不能登记为通过。')\n  return partialSeal(run, measured, result)\n}\n",
      "  if (selected.cases.some(id => measured.cases[id] !== current[id]))\n    throw new Error('执行期间相关测量输入变化，局部结果不能登记为通过。')\n  if (selected.scheme === 'DictionaryTouch') {\n    assertUiReadback(selected, fs.readFileSync(path.join(run, 'readback.log'), 'utf8'))\n    assertUiInteractionLog(selected, fs.readFileSync(path.join(run, 'test.log'), 'utf8'))\n  }\n  return partialSeal(run, measured, result)\n}\n"
    ]
  ]
}

const once = (source, part) => source.indexOf(part) >= 0 && source.indexOf(part, source.indexOf(part) + part.length) < 0

/** The helper is lazy-imported exclusively by this exact dispatcher branch. Any unknown
 * selector/dispatcher layout keeps the full module dependency, even for other cases.
 */
export function isolatedInteraction(root) {
  try {
    const files = ['scripts/lib/ios-debug.mjs', 'scripts/fixtures/dictionary-touch.py']
    const [selector, dispatcher] = files.map(file => {
      const absolute = path.join(root, file)
      if (fs.realpathSync(absolute) !== absolute || !fs.lstatSync(absolute).isFile()) throw new Error('unknown dependency')
      return fs.readFileSync(absolute, 'utf8')
    })
    const exclusive = directory => fs.readdirSync(directory).every(name => {
      if (name === '__pycache__') return true
      const file = path.join(directory, name), stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) return false
      if (stat.isDirectory()) return exclusive(file)
      if (!name.endsWith('.py') || ['dictionary-touch.py', 'ios_interaction.py']
        .some(owned => file === path.join(root, 'scripts/fixtures', owned))) return true
      // A companion or dynamic import may make the helper a shared dependency.
      return !/\bios_interaction\b|\bimportlib\b|\b__import__\s*\(|\b(?:exec|eval)\s*\(/.test(fs.readFileSync(file, 'utf8'))
    })
    return once(selector, selectorBranch) && once(dispatcher, dispatcherBranch) &&
      !/\b(?:ios_interaction|interaction_match|importlib)\b|\b__import__\s*\(|\b(?:exec|eval)\s*\(/.test(dispatcher.replace(dispatcherBranch, '')) &&
      exclusive(path.join(root, 'scripts/fixtures'))
  } catch { return false }
}

export function interactionCase(id) {
  return ['test51IosKeyboardNavigation', 'test52IosCandidatesAndDate', 'test53IosLandscapeCandidates']
    .some(name => id === 'DictionaryUITests/DictionaryTouchTests/' + name)
}

/** Preserve binary assets byte for byte; only the two known text producers are projected. */
export function scopedSource(file, raw, interaction) {
  if (interaction || !['scripts/lib/ios-debug.mjs', 'scripts/fixtures/dictionary-touch.py'].includes(file)) return raw
  const source = raw.toString('utf8')
  return Buffer.from(file.endsWith('ios-debug.mjs')
    ? source.replace(selectorBranch, originalSelectorBranch) : source.replace(dispatcherBranch, ''))
}

/** The original producer SHA in ios-measurement-v1.json is never changed. After reversing
 * these exact reviewed metadata/read-only changes, the ENTIRE source must match that SHA.
 * The policy module itself has a fixed content pin; neither arbitrary AST erasure nor a
 * caller-provided historical source can make a changed producer compatible.
 */
export function legacyProducerSource(file, source) {
  if (!Object.hasOwn(legacyChanges, file)) return undefined
  let original = source.replace(/^const scopedPolicySha = '[a-f0-9]{64}'$/m,
    "const scopedPolicySha = 'SCOPED_POLICY_SHA'")
  for (const [before, after] of legacyChanges[file]) {
    if (!once(original, after)) return undefined
    original = original.replace(after, before)
  }
  return original
}
