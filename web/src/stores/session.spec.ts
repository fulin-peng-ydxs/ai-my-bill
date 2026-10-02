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

  it('retains the authenticated state when logout cannot reach the server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')))
    const store = useSessionStore()
    store.accept({
      accountId: '10000000-0000-0000-0000-000000000001',
      username: 'alice',
      role: 'USER',
      passwordChangeRequired: false,
    })

    await expect(store.logout()).rejects.toThrow('network unavailable')
    expect(store.isAuthenticated).toBe(true)
    expect(store.session?.username).toBe('alice')
  })

  it('refreshes the guest CSRF cookie after a successful logout', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'UNAUTHORIZED', message: 'expired', fieldErrors: {}, traceId: 'trace', retryable: false,
      }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const store = useSessionStore()
    store.accept({
      accountId: '10000000-0000-0000-0000-000000000001',
      username: 'alice',
      role: 'USER',
      passwordChangeRequired: false,
    })

    await store.logout()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(store.status).toBe('guest')
    expect(store.session).toBeUndefined()
  })

  it('refreshes the CSRF cookie before login after an initial network failure', async () => {
    const session = {
      accountId: '10000000-0000-0000-0000-000000000001',
      username: 'alice',
      role: 'USER' as const,
      passwordChangeRequired: false,
    }
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'UNAUTHORIZED', message: 'expired', fieldErrors: {}, traceId: 'trace', retryable: false,
      }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(session), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const store = useSessionStore()
    await store.initialize()

    await expect(store.login('alice', 'correct password')).resolves.toEqual(session)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(store.isAuthenticated).toBe(true)
  })
})

describe('password change session handling', () => {
  const original = { accountId: '10000000-0000-4000-8000-000000000099', username: 'preview', role: 'USER' as const, passwordChangeRequired: false }
  it('sends only current and new passwords and accepts the rotated server session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(original), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const store = useSessionStore()
    store.accept(original)
    await store.changePassword('old-password', 'new-password-long-enough')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/password', expect.objectContaining({ method: 'POST', body: JSON.stringify({ currentPassword: 'old-password', newPassword: 'new-password-long-enough' }) }))
    expect(store.session).toEqual(original)
    expect(store.status).toBe('authenticated')
  })
  it('preserves the current session when the current password is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS', message: '密码不正确', fieldErrors: {}, retryable: false }), { status: 401, headers: { 'Content-Type': 'application/json' } })))
    const store = useSessionStore()
    store.accept(original)
    await expect(store.changePassword('wrong', 'new-password-long-enough')).rejects.toThrow()
    expect(store.session).toEqual(original)
    expect(store.status).toBe('authenticated')
  })
})
