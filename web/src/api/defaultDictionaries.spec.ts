import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  changeDefaultDictionaryItemStatus,
  createDefaultDictionaryItem,
  listDefaultDictionaryItems,
  moveDefaultDictionaryItem,
} from './defaultDictionaries'

afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('default dictionary api', () => {
  it('encodes list filters and preserves literal search input', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0, page: 2, size: 20 }))
    vi.stubGlobal('fetch', fetch)

    await listDefaultDictionaryItems('expense-category', '餐 饮%_A', 'ACTIVE', undefined, 2, 20)

    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/admin/default-dictionaries/expense-category?query=%E9%A4%90+%E9%A5%AE%25_A&page=2&size=20&status=ACTIVE',
    )
  })

  it('sends create, status and move mutations to the selected dictionary type', async () => {
    const responseBody = {
      id: '10000000-0000-0000-0000-000000000001',
      type: 'expense-category',
      name: '早餐',
      parentId: '10000000-0000-0000-0000-000000000002',
      status: 'ACTIVE',
      sortOrder: 10,
    }
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(responseBody)))
    vi.stubGlobal('fetch', fetch)

    await createDefaultDictionaryItem('expense-category', '早餐', '10000000-0000-0000-0000-000000000002')
    await changeDefaultDictionaryItemStatus(
      'expense-category',
      '10000000-0000-0000-0000-000000000001',
      'INACTIVE',
    )
    await moveDefaultDictionaryItem('expense-category', '10000000-0000-0000-0000-000000000001', 'UP')

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/admin/default-dictionaries/expense-category', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: '早餐', parentId: '10000000-0000-0000-0000-000000000002' }),
    }))
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/admin/default-dictionaries/expense-category/10000000-0000-0000-0000-000000000001/status',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ status: 'INACTIVE' }) }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      '/api/v1/admin/default-dictionaries/expense-category/10000000-0000-0000-0000-000000000001/move',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ direction: 'UP' }) }),
    )
  })
})
