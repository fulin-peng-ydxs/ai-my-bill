import { afterEach, describe, expect, it, vi } from 'vitest'

import { createExpenseAdjustment, getExpenseAdjustment, revokeExpenseAdjustment } from './expenseAdjustments'

afterEach(() => vi.unstubAllGlobals())

describe('expense adjustment api', () => {
  it('keeps the source in the path and sends decimal strings with an idempotency key', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'adjustment' }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await createExpenseAdjustment('expense/id', {
      adjustmentType: 'REFUND', amount: '30.00', occurredAt: '2026-09-07T05:00:00Z',
    }, 'adjust-key')
    expect(fetch.mock.calls[0]?.[0]).toContain('/ledger-entries/expense%2Fid/adjustments')
    const options = fetch.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('adjust-key')
    expect(JSON.parse(String(options.body)).amount).toBe('30.00')
  })

  it('encodes detail and revoke ids and carries the optimistic version', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: 'adjustment', version: 1 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await getExpenseAdjustment('adjustment/id')
    await revokeExpenseAdjustment('adjustment/id', 0, 'revoke-key')
    expect(fetch.mock.calls[0]?.[0]).toContain('/adjustments/adjustment%2Fid')
    expect(fetch.mock.calls[1]?.[0]).toContain('/adjustments/adjustment%2Fid/revoke')
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ version: 0 })
  })
})
