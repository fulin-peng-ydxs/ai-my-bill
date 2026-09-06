import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIncome, listRecentIncomeNames, undoCreatedIncome } from './incomes'

afterEach(() => vi.unstubAllGlobals())
describe('income api', () => {
  it('encodes names and preserves decimal strings with the idempotency key', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ items: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await listRecentIncomeNames('稿费 & 奖金')
    expect(fetch.mock.calls[0]?.[0]).toContain('query=%E7%A8%BF%E8%B4%B9+%26+%E5%A5%96%E9%87%91')
    await createIncome({ incomeName: '稿费', payerId: 'payer', incomeCategoryId: 'category', amount: '12.30',
      fundingChannelId: 'funding', occurredAt: '2026-09-06T02:30:00Z' }, 'income-key')
    const options = fetch.mock.calls[1]?.[1] as RequestInit
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('income-key')
    expect(JSON.parse(String(options.body)).amount).toBe('12.30')
  })
  it('encodes the income id for undo', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetch)
    await undoCreatedIncome('income/id', 'key')
    expect(fetch.mock.calls[0]?.[0]).toContain('/incomes/income%2Fid/undo')
  })
})
