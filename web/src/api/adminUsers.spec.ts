import { afterEach, describe, expect, it, vi } from 'vitest'

import { listAdminUsers } from './adminUsers'

afterEach(() => vi.unstubAllGlobals())

describe('admin user pagination', () => {
  it('sends the requested page with the applied search and status', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 120 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await listAdminUsers('user%_ A', 'DISABLED', signal, 2)
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/admin/users?query=user%25_+A&page=2&size=50&status=DISABLED')
  })
})
