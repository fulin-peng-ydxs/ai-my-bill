import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const stylesPath = fileURLToPath(new URL('./tokens.css', import.meta.url))
const styles = readFileSync(stylesPath, 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? ''
}

describe('responsive and accessibility style contracts', () => {
  it('keeps mobile navigation and low-frequency actions at least 44px tall', () => {
    expect(styles).toMatch(/\.form-field select,\s*\.select-control\s*\{[\s\S]*?min-height: var\(--control-height\);/)
    expect(rule('.admin-mobile-navigation a')).toContain('min-height: 44px')
    expect(rule('.reset-preferences-action')).toContain('min-height: 44px')
    expect(rule('.admin-search input')).toContain('height: 44px')
    expect(styles).toMatch(/\.default-type-picker select,\s*\.admin-audit-toolbar select,\s*\.admin-toolbar select\s*\{[\s\S]*?min-height: 44px;/)
  })

  it('locks the background document while a native modal dialog is open', () => {
    expect(styles).toMatch(/html:has\(dialog\[open\]\),\s*body:has\(dialog\[open\]\)\s*\{\s*overflow: hidden;/)
  })

  it('uses dynamic viewport units and honors reduced motion globally', () => {
    expect(styles).toContain('min-height: 100dvh')
    expect(rule('.app-bootstrap-state')).toContain('place-items: center')
    expect(rule('.app-bootstrap-state')).toContain('safe-area-inset-top')
    expect(styles).not.toMatch(/height:\s*calc\(100vh\s*-/)
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('animation-duration: 0.01ms !important')
  })
})

// A missing token silently removes card boundaries or focus outlines in the browser.
describe('shared style token references', () => {
  it('resolves tokens used without fallbacks in global and component styles', () => {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const componentStyles = readdirSync(root, { recursive: true })
      .filter((name) => typeof name === 'string' && name.endsWith('.vue'))
      .map((name) => readFileSync(`${root}/${name}`, 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '')
    const motionStyles = readFileSync(`${root}/styles/motion.css`, 'utf8')
    const sources = [styles, motionStyles, ...componentStyles].join('\n')
    const defined = new Set(Array.from(sources.matchAll(/(--[\w-]+)\s*:/g), (match) => match[1]))
    const missing = Array.from(sources.matchAll(/var\((--[\w-]+)\)/g), (match) => match[1])
      .filter((name) => !defined.has(name))
    expect([...new Set(missing)]).toEqual([])
  })
})
