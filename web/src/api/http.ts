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
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
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

  const response = await fetch(`/api/v1${path}`, {
    ...init,
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) {
    let body: ApiErrorBody | undefined
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      body = undefined
    }
    throw new ApiClientError(response.status, body)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}
