import { afterEach, describe, expect, it, vi } from 'vitest'

import { cancelExport, createExport, getExport } from './exports'

const response = {
  id: '18800000-0000-4000-8000-000000000001', scope: 'ALL_DATA', status: 'PENDING', rowCount: 0,
  createdAt: '2026-09-07T10:00:00Z', expiresAt: '2026-09-08T10:00:00Z',
}

afterEach(() => vi.unstubAllGlobals())

describe('personal export api', () => {
  it('uses the shared API security boundary for create, status and cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => response })
    vi.stubGlobal('fetch', fetchMock)

    await createExport({ scope: 'ALL_DATA' }, 'export-attempt')
    await getExport(response.id)
    await cancelExport(response.id)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/exports')
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get('Idempotency-Key')).toBe('export-attempt')
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/v1/exports/${response.id}`)
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/v1/exports/${response.id}/cancel`)
    expect(fetchMock.mock.calls.every((call) => call[1]?.cache === 'no-store')).toBe(true)
  })
})
