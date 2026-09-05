import { afterEach, describe, expect, it, vi } from 'vitest'

import { changeDictionaryItemStatus, DICTIONARY_CHANGED_EVENT } from './dictionaries'

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
})
