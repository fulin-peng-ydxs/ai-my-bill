import type { components } from './generated/schema'

export type ApiErrorBody = components['schemas']['ApiError']

export class ApiClientError extends Error {
  readonly status: number
  readonly body?: ApiErrorBody

  constructor(status: number, body?: ApiErrorBody) {
    super(body?.message ?? `请求失败（${status}）`)
    this.name = 'ApiClientError'
    this.status = status
    this.body = body
  }
}

export class ApiTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super('请求超时，请稍后重试。')
    this.name = 'ApiTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export interface ApiRequestInit extends RequestInit {
  timeoutMs?: number
}

export function readCookie(name: string, cookieHeader?: string): string | undefined {
  const source = cookieHeader ?? (typeof document === 'undefined' ? '' : document.cookie)
  return source
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split('='))
    .find(([cookieName]) => cookieName === name)
    ?.slice(1)
    .join('=')
}

/** 同源 API 统一入口：携带 Cookie，并为变更请求附加服务端签发的 CSRF token。 */
export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  const controller = new AbortController()
  const timeoutMs = init.timeoutMs ?? 15_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('请求超时必须是正毫秒数。')
  let timedOut = false
  const abortFromCaller = () => controller.abort(init.signal?.reason)
  if (init.signal?.aborted) abortFromCaller()
  else init.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = readCookie('XSRF-TOKEN')
    if (csrfToken) {
      headers.set('X-XSRF-TOKEN', decodeURIComponent(csrfToken))
    }
  }

  try {
    const requestInit = { ...init }
    delete requestInit.timeoutMs
    const response = await fetch(`/api/v1${path}`, {
      ...requestInit,
      method,
      headers,
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response.ok) {
      let body: ApiErrorBody | undefined
      try {
        body = (await response.json()) as ApiErrorBody
      } catch (error) {
        if (controller.signal.aborted) throw error
        body = undefined
      }
      throw new ApiClientError(response.status, body)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  } catch (error) {
    if (timedOut) throw new ApiTimeoutError(timeoutMs)
    throw error
  } finally {
    clearTimeout(timeout)
    init.signal?.removeEventListener('abort', abortFromCaller)
  }
}
