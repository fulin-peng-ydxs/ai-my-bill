import { describe, expect, it } from 'vitest'

import { hasLedgerPointerMoved } from './ledgerInteraction'

describe('ledger item interactions', () => {
  it('allows tap jitter but detects movement in every direction to cancel a pending long press', () => {
    expect(hasLedgerPointerMoved(180, 100, 182, 103)).toBe(false)
    expect(hasLedgerPointerMoved(180, 100, 120, 106)).toBe(true)
    expect(hasLedgerPointerMoved(180, 100, 240, 100)).toBe(true)
    expect(hasLedgerPointerMoved(180, 100, 180, 140)).toBe(true)
    expect(hasLedgerPointerMoved(180, 100, 180, 60)).toBe(true)
    expect(hasLedgerPointerMoved(180, 100, 172, 100)).toBe(true)
  })
})
