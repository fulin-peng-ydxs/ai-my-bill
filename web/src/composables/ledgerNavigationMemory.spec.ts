import { beforeEach, describe, expect, it } from 'vitest'

import { clearAccountMemory } from './accountMemory'
import { clearLedgerScrollMemory, ledgerScrollKey, readLedgerScroll, rememberLedgerScroll } from './ledgerNavigationMemory'

describe('ledger navigation memory', () => {
  beforeEach(clearLedgerScrollMemory)
  it('keeps a finite scroll position only for the exact route key', () => {
    const routeKey = ledgerScrollKey('account-a', '/ledger?range=TODAY')
    rememberLedgerScroll(routeKey, 420)
    rememberLedgerScroll('', 10)
    rememberLedgerScroll('/ledger?range=BAD', Number.NaN)
    expect(readLedgerScroll(routeKey)).toBe(420)
    expect(readLedgerScroll(ledgerScrollKey('account-a', '/ledger?range=THIS_MONTH'))).toBeUndefined()
    expect(readLedgerScroll(ledgerScrollKey('account-b', '/ledger?range=TODAY'))).toBeUndefined()
    clearAccountMemory('account-a')
    expect(readLedgerScroll(routeKey)).toBeUndefined()
  })

  it('bounds route history so arbitrary filters cannot grow memory indefinitely', () => {
    for (let index = 0; index <= 100; index++) rememberLedgerScroll(`account|/ledger?q=${index}`, index)
    expect(readLedgerScroll('account|/ledger?q=0')).toBeUndefined()
    expect(readLedgerScroll('account|/ledger?q=100')).toBe(100)
  })
})
