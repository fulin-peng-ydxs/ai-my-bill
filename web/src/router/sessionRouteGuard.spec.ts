import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import router from './index'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.unstubAllGlobals()
})

describe('session route guard', () => {
  it('sends guests to login while retaining their intended route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      code: 'UNAUTHORIZED', message: 'expired', fieldErrors: {}, traceId: 'trace', retryable: false,
    }, 401)))

    await router.push('/reports')

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/reports')
  })

  it('routes an authenticated administrator away from user-only pages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      accountId: '10000000-0000-0000-0000-000000000001',
      username: 'system-admin',
      role: 'ADMIN',
      passwordChangeRequired: false,
    })))

    await router.push('/entry')

    expect(router.currentRoute.value.path).toBe('/admin')
  })
})
