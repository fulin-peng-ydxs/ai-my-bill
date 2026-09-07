import { afterEach, describe, expect, it, vi } from 'vitest'

import { listLedgerEntries } from './ledgerEntries'

describe('ledger entries api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('serializes filters and cursor without leaking unsupported fields', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], hasMore: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await listLedgerEntries({ query: '早餐', type: 'EXPENSE', lifecycle: 'TRASHED', range: 'CUSTOM', startDate: '2026-09-01',
      endDate: '2026-09-07', fundingChannelId: 'funding-id' }, 'opaque cursor')
    const url = String(fetch.mock.calls[0]?.[0])
    expect(url).toContain('/api/v1/ledger-entries?')
    expect(url).toContain('query=%E6%97%A9%E9%A4%90')
    expect(url).toContain('cursor=opaque+cursor')
    expect(url).toContain('startDate=2026-09-01')
    expect(url).toContain('lifecycle=TRASHED')
  })
})
