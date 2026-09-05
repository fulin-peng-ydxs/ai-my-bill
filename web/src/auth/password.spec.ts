import { describe, expect, it } from 'vitest'

import { isFormalPasswordLengthValid } from './password'

describe('formal password length', () => {
  it('counts Unicode code points instead of UTF-16 code units', () => {
    expect(isFormalPasswordLengthValid('🔐'.repeat(15))).toBe(true)
    expect(isFormalPasswordLengthValid('🔐'.repeat(64))).toBe(true)
    expect(isFormalPasswordLengthValid('🔐'.repeat(65))).toBe(false)
  })
})
