import { afterEach, describe, expect, it, vi } from 'vitest'

import { changeDictionaryItemStatus, DICTIONARY_CHANGED_EVENT, mergeProduct } from './dictionaries'

afterEach(() => vi.unstubAllGlobals())

describe('personal dictionary api', () => {
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
