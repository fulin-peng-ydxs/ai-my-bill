import { afterEach, describe, expect, it, vi } from 'vitest'

import { changeLedgerLifecycle } from './ledgerLifecycle'

describe('ledger lifecycle api', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the ledger resource for income and sends only version plus the idempotency key', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'entry', entryType: 'INCOME',
      lifecycleStatus: 'TRASHED', version: 3, linkedAdjustmentCount: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await changeLedgerLifecycle({ id: 'entry', entryType: 'INCOME', version: 2 }, 'trash', 'stable-key')
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/api/v1/ledger-entries/entry/trash')
    const init = fetch.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('stable-key')
    expect(init.body).toBe('{"version":2}')
  })

  it('uses the adjustment resource and accepts a no-content purge response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await expect(changeLedgerLifecycle({ id: 'adjustment', entryType: 'ADJUSTMENT', version: 1 },
      'purge', 'purge-key')).resolves.toBeUndefined()
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/api/v1/adjustments/adjustment/purge')
  })
})
