import { describe, expect, it } from 'vitest'

import { formatLedgerCounterparty } from './ledgerFormatting'

describe('ledger quantity presentation', () => {
  it('formats only the leading expense quantity and preserves contextual names', () => {
    expect(formatLedgerCounterparty({ entryType: 'EXPENSE', counterpartyName: '2.000 份 · 店铺 3.00' })).toBe('2 份 · 店铺 3.00')
    expect(formatLedgerCounterparty({ entryType: 'EXPENSE', counterpartyName: '1.250 千克' })).toBe('1.250 千克')
    expect(formatLedgerCounterparty({ entryType: 'INCOME', counterpartyName: '2.000 公司' })).toBe('2.000 公司')
    expect(formatLedgerCounterparty({ entryType: 'ADJUSTMENT', counterpartyName: '原支出 · 商品 1.00' })).toBe('原支出 · 商品 1.00')
  })
})
