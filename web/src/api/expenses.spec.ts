import { afterEach, describe, expect, it, vi } from 'vitest'

import { createExpense, listExpenseProducts, undoCreatedExpense } from './expenses'

afterEach(() => vi.unstubAllGlobals())

describe('expense api', () => {
  it('encodes product search text as a query parameter', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)

    await listExpenseProducts('咖啡 & 茶')

    expect(fetch.mock.calls[0]?.[0]).toContain('/expenses/products?query=%E5%92%96%E5%95%A1+%26+%E8%8C%B6')
  })

  it('sends decimal strings and the caller idempotency key when creating', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'expense' }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    const request = {
      productId: '10000000-0000-4000-8000-000000000001',
      primaryCategoryId: '10000000-0000-4000-8000-000000000002',
      unitId: '10000000-0000-4000-8000-000000000003',
      unitPrice: '12.30', quantity: '2.5', paidAmount: '30.75',
      fundingChannelId: '10000000-0000-4000-8000-000000000004',
      occurredAt: '2026-09-06T02:30:00Z',
    }

    await createExpense(request, 'entry-key')

    const options = fetch.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('entry-key')
    expect(JSON.parse(String(options.body))).toMatchObject({
      unitPrice: '12.30', quantity: '2.5', paidAmount: '30.75',
    })
  })

  it('encodes the expense id in the undo endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await undoCreatedExpense('expense/id', 'undo-key')

    expect(fetch.mock.calls[0]?.[0]).toContain('/expenses/expense%2Fid/undo')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' })
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Idempotency-Key')).toBe('undo-key')
  })
})
