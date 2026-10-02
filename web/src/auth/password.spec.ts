import { describe, expect, it } from 'vitest'

import { isFormalPasswordLengthValid, validatePasswordChange } from './password'

describe('formal password length', () => {
  it('counts Unicode code points instead of UTF-16 code units', () => {
    expect(isFormalPasswordLengthValid('🔐'.repeat(15))).toBe(true)
    expect(isFormalPasswordLengthValid('🔐'.repeat(64))).toBe(true)
    expect(isFormalPasswordLengthValid('🔐'.repeat(65))).toBe(false)
  })
})

describe('password change validation', () => {
  it('rejects missing current password, reused passwords and mismatched confirmation', () => {
    expect(validatePasswordChange({ currentPassword: '', newPassword: 'short', confirmPassword: '' })).toHaveProperty('currentPassword')
    expect(validatePasswordChange({ currentPassword: 'a'.repeat(15), newPassword: 'a'.repeat(15), confirmPassword: 'a'.repeat(15) })).toHaveProperty('newPassword')
    expect(validatePasswordChange({ currentPassword: 'old', newPassword: 'b'.repeat(15), confirmPassword: 'different' })).toHaveProperty('confirmPassword')
  })
  it('accepts matching Unicode passwords without trimming meaningful characters', () => {
    const password = '🔐'.repeat(15)
    expect(validatePasswordChange({ currentPassword: 'old', newPassword: password, confirmPassword: password })).toEqual({})
  })
})
