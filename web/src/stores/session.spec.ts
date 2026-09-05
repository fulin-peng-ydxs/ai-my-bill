import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessionStore } from './session'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.unstubAllGlobals()
})

describe('session store', () => {
  it('treats an unauthorized session lookup as a recoverable guest state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'UNAUTHORIZED', message: 'expired', fieldErrors: {}, traceId: 'trace', retryable: false,
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })))

    const store = useSessionStore()
    await store.initialize()

    expect(store.status).toBe('guest')
    expect(store.session).toBeUndefined()
  })

  it('uses the server session response as the only authenticated identity source', async () => {
    const session = {
      accountId: '10000000-0000-0000-0000-000000000001',
      username: 'alice',
      role: 'USER' as const,
      passwordChangeRequired: false,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(session), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })))

    const store = useSessionStore()
    await store.initialize()

    expect(store.isAuthenticated).toBe(true)
    expect(store.session).toEqual(session)
  })
})
