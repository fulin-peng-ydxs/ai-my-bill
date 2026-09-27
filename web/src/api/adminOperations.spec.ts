import { afterEach, describe, expect, it, vi } from 'vitest'

import { getAdminOverview, listAdminAuditLogs } from './adminOperations'

afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('admin operations api', () => {
  it('loads the overview from the isolated admin endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetch)

    await getAdminOverview()

    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/admin/overview')
  })

  it('encodes every audit filter and pagination value', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0, page: 2, size: 50 }))
    vi.stubGlobal('fetch', fetch)

    await listAdminAuditLogs({
      administrator: 'admin%_A', action: 'CREATE_USER', object: 'USER / 1',
      result: 'SUCCEEDED', period: 'LAST_7_DAYS', page: 2,
    })

    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/admin/audit-logs?administrator=admin%25_A&action=CREATE_USER&object=USER+%2F+1&period=LAST_7_DAYS&page=2&size=50&result=SUCCEEDED',
    )
  })
})
