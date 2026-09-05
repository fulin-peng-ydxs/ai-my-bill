import { describe, expect, it } from 'vitest'

import { isThemeMode, resolveTheme, themeModeLabel } from './theme'

describe('theme contract', () => {
  it('accepts only the three documented modes', () => {
    expect(['system', 'light', 'dark'].filter(isThemeMode)).toEqual(['system', 'light', 'dark'])
    expect(isThemeMode('auto')).toBe(false)
  })

  it('resolves system mode without changing explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(themeModeLabel('dark')).toBe('夜晚')
  })
})
