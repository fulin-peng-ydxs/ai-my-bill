import { afterEach, describe, expect, it, vi } from 'vitest'

import { changeDictionaryItemStatus, DICTIONARY_CHANGED_EVENT, getDictionaryItem, listDictionaryItems, mergeProduct } from './dictionaries'

afterEach(() => vi.unstubAllGlobals())

describe('personal dictionary api', () => {
  it('pages historical choices without an active-only filter and resolves selected IDs directly', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ items: [], total: 56, page: 2, size: 20 })))
    vi.stubGlobal('fetch', fetchMock)
    await listDictionaryItems('expense-category', '午餐', '', undefined, 2, 20, { parentId: 'parent' })
    const url = new URL(fetchMock.mock.calls[0]![0] as string, 'https://example.test')
    expect(url.searchParams.get('status')).toBeNull()
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('size')).toBe('20')
    expect(url.searchParams.get('parentId')).toBe('parent')
    await getDictionaryItem('funding-channel', 'stopped-id')
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/dictionaries/funding-channel/stopped-id')
  })

  it('notifies candidate consumers only after a successful mutation', async () => {
    const dispatch = vi.fn()
    vi.stubGlobal('dispatchEvent', dispatch)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: '10000000-0000-0000-0000-000000000001',
      type: 'unit',
      name: '盒',
      status: 'INACTIVE',
      sortOrder: 10,
      referenced: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await changeDictionaryItemStatus('unit', '10000000-0000-0000-0000-000000000001', 'INACTIVE')

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ type: DICTIONARY_CHANGED_EVENT })
  })

  it('does not notify consumers when the mutation fails', async () => {
    const dispatch = vi.fn()
    vi.stubGlobal('dispatchEvent', dispatch)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'DICTIONARY_NAME_CONFLICT', message: '名称冲突', fieldErrors: {}, traceId: 't', retryable: false,
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })))

    await expect(changeDictionaryItemStatus('unit', '10000000-0000-0000-0000-000000000001', 'INACTIVE'))
      .rejects.toThrow('名称冲突')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('notifies product candidate consumers only after a merge succeeds', async () => {
    const dispatch = vi.fn()
    vi.stubGlobal('dispatchEvent', dispatch)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      mergeEventId: '10000000-0000-0000-0000-000000000003',
      impact: {
        source: { id: '10000000-0000-0000-0000-000000000001', name: '旧商品' },
        target: { id: '10000000-0000-0000-0000-000000000002', name: '保留商品' },
        affectedLedgerEntries: 2,
        affectedTemplates: 1,
        templateConflict: false,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await mergeProduct(
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
    )

    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: DICTIONARY_CHANGED_EVENT,
      detail: { type: 'product' },
    })
  })
})
