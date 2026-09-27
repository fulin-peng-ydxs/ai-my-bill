import { afterEach, describe, expect, it, vi } from 'vitest'

import { deleteAdminAccount, deleteCurrentAccount } from './accountDeletion'

const result = {
  deletionReference: '19900000-0000-4000-8000-000000000001',
  executedAt: '2026-09-27T04:00:00Z',
  auditExpiresAt: '2027-03-26T04:00:00Z',
}

afterEach(() => vi.unstubAllGlobals())

describe('account deletion api', () => {
  it('uses the shared no-store security boundary for self and administrator deletion', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => result })
    vi.stubGlobal('fetch', fetchMock)

    await deleteCurrentAccount('alice')
    await deleteAdminAccount('19800000-0000-4000-8000-000000000001', 3)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/me/deletion')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/admin/users/19800000-0000-4000-8000-000000000001/deletion')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({ confirmation: 'alice' })
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({ version: 3 })
    expect(fetchMock.mock.calls.every((call) => call[1]?.cache === 'no-store')).toBe(true)
  })
})
