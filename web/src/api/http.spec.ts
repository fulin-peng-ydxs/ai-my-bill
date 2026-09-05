import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError, apiRequest, readCookie } from './http'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('shared api client', () => {
  it('reads one encoded cookie without confusing prefix names', () => {
    expect(readCookie('XSRF-TOKEN', 'OTHER_XSRF-TOKEN=no; XSRF-TOKEN=a%2Fb%3D')).toBe('a%2Fb%3D')
  })

  it('adds the decoded csrf token and same-origin credentials to mutations', async () => {
    vi.stubGlobal('document', { cookie: 'XSRF-TOKEN=a%2Fb%3D' })
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest<void>('/auth/logout', { method: 'POST' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.credentials).toBe('same-origin')
    expect(new Headers(init.headers).get('X-XSRF-TOKEN')).toBe('a/b=')
  })

  it('preserves the stable api error body for caller decisions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'UNAUTHORIZED',
      message: '会话已失效，请重新登录。',
      fieldErrors: {},
      traceId: 'trace-1',
      retryable: false,
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })))

    try {
      await apiRequest('/auth/session')
      throw new Error('expected request to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError)
      expect(error).toMatchObject({ status: 401, body: { code: 'UNAUTHORIZED' } })
    }
  })

  it('aborts and classifies a request that exceeds its timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))

    const request = apiRequest('/slow', { timeoutMs: 100 })
    const rejection = expect(request).rejects.toMatchObject({ name: 'ApiTimeoutError', timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(100)

    await rejection
  })

  it('preserves caller cancellation instead of classifying it as a timeout', async () => {
    const caller = new AbortController()
    caller.abort()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => Promise.reject(init.signal?.reason)))

    await expect(apiRequest('/canceled', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
