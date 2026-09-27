import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const stylesPath = fileURLToPath(new URL('./tokens.css', import.meta.url))
const styles = readFileSync(stylesPath, 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? ''
}

describe('responsive and accessibility style contracts', () => {
  it('keeps mobile navigation and low-frequency actions at least 44px tall', () => {
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
