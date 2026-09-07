import { describe, expect, it } from 'vitest'

import { isLedgerContextSwipe } from './ledgerInteraction'

describe('ledger item interactions', () => {
  it('accepts intentional left swipes without treating taps or vertical scrolling as context actions', () => {
    expect(isLedgerContextSwipe(180, 100, 120, 106)).toBe(true)
    expect(isLedgerContextSwipe(180, 100, 145, 102)).toBe(false)
    expect(isLedgerContextSwipe(180, 100, 120, 170)).toBe(false)
    expect(isLedgerContextSwipe(120, 100, 180, 100)).toBe(false)
  })
})
