import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const styles = ['app/src/styles/tokens.css', 'app/src/styles/focus.css']
const keyboard = 'app/src/composables/useKeyboardViewport.ts'
const baseline = 'app/src/app/uiBaseline.json'
const retired = /^(?:(?:admin|auth|audit)-[\w-]+|temporary-credential|user-detail-list|password-change-form|install-prompt|inline-help|app-data-table|data-table-scroll)$/
const retiredText = /\b(?:(?:admin|auth|audit)-[\w-]+|temporary-credential|user-detail-list|password-change-form|install-prompt|inline-help|app-data-table|data-table-scroll|PENDING_FIRST_LOGIN|DELETION_PENDING)\b/

// A selector arm is removable only when a retired class is mandatory, outside functions/attributes.
function mandatoryRetired(selector) {
  let parentheses = 0, brackets = 0, quote = '', found = false
  if (selector.includes('\\')) throw new Error('Escaped selectors need ordinary validation')
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '[') brackets++
    if (c === ']') brackets--
    if (!brackets && c === '(') parentheses++
    if (!brackets && c === ')') parentheses--
    if (!parentheses && !brackets && c === '.') {
      const name = selector.slice(i + 1).match(/^[\w-]+/)?.[0]
      if (name && retired.test(name)) found = true
    }
  }
  if (quote || brackets || parentheses) throw new Error('Unbalanced selector')
  return found
}

function selectors(node, before) {
  return node.selectors.flatMap(original => {
    let selector = original
    if (before) {
      selector = selector.replaceAll('.app-shell:not(.admin-shell)', '.app-shell.app-shell')
        .replaceAll('.app-shell.keyboard-open:not(.admin-shell)', '.app-shell.keyboard-open.app-shell')
        .replaceAll(':is(.global-search, .admin-search, .date-time-control)', ':is(.global-search, .date-time-control)')
      if (mandatoryRetired(selector) || /^\.status-badge\[data-status="(?:PENDING_FIRST_LOGIN|DELETION_PENDING)"\]$/.test(selector)) return []
    }
    // New dead rules and unsupported nested references are not a retirement-only change.
    if (retiredText.test(selector)) throw new Error('Unsupported retired selector')
    return [selector]
  })
}

function projection(css, before) {
  const root = require('postcss').parse(css)
  const nodes = parent => parent.nodes.flatMap(node => {
    if (node.type === 'comment') return []
    if (node.type === 'decl') return [['declaration', node.prop, node.value, Boolean(node.important)]]
    if (node.type === 'rule') {
      const arms = selectors(node, before)
      return arms.length ? [['rule', arms, nodes(node)]] : []
    }
    if (node.type === 'atrule') {
      const children = node.nodes ? nodes(node) : null
      if (before && children?.length === 0 && ['media', 'supports'].includes(node.name)) return []
      return [['at-rule', node.name, node.params, children]]
    }
    throw new Error('Unknown CSS node')
  })
  return JSON.stringify(nodes(root))
}

/** Consumer-side selection proof only. Does not change measurement inputs, receipts or failure locks. */
export function retiredStyleChanges(root, files, changes) {
  const ignored = new Set()
  if (!root || !changes || !styles.some(file => files.includes(file))) return ignored
  try {
    for (const file of files) {
      if (styles.includes(file) || file === baseline || file === keyboard || file.endsWith('.spec.ts')) continue
      if (/^(?:app\/|config\/|scripts\/)/.test(file) && !file.startsWith('scripts/tests/')) return ignored
      if (file === '.nvmrc' || /^package(?:-lock)?\.json$/.test(file)) return ignored
    }
    const change = changes.get(keyboard)
    if (files.includes(keyboard) && (!change?.before || change.after !== change.before.replace("'.app-shell:not(.admin-shell)'", "'.app-shell'"))) return ignored
    if (files.includes(baseline)) {
      const value = changes.get(baseline)
      const before = JSON.parse(value.before), after = JSON.parse(value.after)
      delete before.styleAdaptations; delete after.styleAdaptations
      if (JSON.stringify(before) !== JSON.stringify(after)) return ignored
    }
    // Read tracked candidate sources as data. Changed blobs override the trusted checkout.
    const tracked = execFileSync('git', ['ls-files', '-z', '--', 'app/src', 'app/index.html'], {
      cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024
    }).split('\0').filter(Boolean)
    const sources = [...new Set([...tracked, ...files.filter(file => file.startsWith('app/src/'))])]
    if (!sources.length || sources.length > 1024) return ignored
    let size = 0
    for (const file of sources) {
      if (styles.includes(file) || file === baseline || file.endsWith('.spec.ts')) continue
      let text
      if (changes.has(file)) text = changes.get(file).after
      else {
        const absolute = path.join(root, file), stat = fs.lstatSync(absolute)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return ignored
        text = fs.readFileSync(absolute, 'utf8')
      }
      if (text === null) continue
      size += Buffer.byteLength(text)
      if (size > 8 * 1024 * 1024 || retiredText.test(text)) return ignored
    }
    for (const file of styles.filter(file => files.includes(file))) {
      const value = changes.get(file)
      if (typeof value?.before !== 'string' || typeof value.after !== 'string' ||
          projection(value.before, true) !== projection(value.after, false)) return ignored
    }
    for (const file of [...styles, baseline]) if (files.includes(file)) ignored.add(file)
    return ignored
  } catch { return new Set() } // Missing blobs/parser, malformed syntax and unsupported cases stay conservative.
}
