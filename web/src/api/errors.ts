import { ApiClientError, type ApiErrorBody, ApiTimeoutError } from './http'

export type RequestErrorKind =
  | 'canceled'
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'validation'
  | 'conflict'
  | 'rate-limited'
  | 'unavailable'
  | 'unexpected'

export interface RequestError {
  kind: RequestErrorKind
  message: string
  fieldErrors: Record<string, string[]>
  traceId?: string
  retryable: boolean
  cause: unknown
}

function kindForStatus(status: number): RequestErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 400 || status === 422) return 'validation'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'unavailable'
  return 'unexpected'
}

function bodyFields(body?: ApiErrorBody): Record<string, string[]> {
  return body?.fieldErrors ?? {}
}

/** 把 HTTP、断网和主动取消统一为页面可安全展示的错误，不暴露堆栈或身份边界字段。 */
export function normalizeRequestError(error: unknown): RequestError {
  if (error instanceof Error && error.name === 'AbortError') {
    return { kind: 'canceled', message: '请求已取消。', fieldErrors: {}, retryable: false, cause: error }
  }
  if (error instanceof ApiTimeoutError) {
    return { kind: 'timeout', message: error.message, fieldErrors: {}, retryable: true, cause: error }
  }
  if (error instanceof ApiClientError) {
    return {
      kind: kindForStatus(error.status),
      message: error.body?.message ?? error.message,
      fieldErrors: bodyFields(error.body),
      traceId: error.body?.traceId,
      retryable: error.body?.retryable ?? error.status >= 500,
      cause: error,
    }
  }
  if (error instanceof TypeError) {
    return { kind: 'network', message: '网络连接不可用，请检查网络后重试。', fieldErrors: {}, retryable: true, cause: error }
  }
  return {
    kind: 'unexpected',
    message: error instanceof Error ? error.message : '请求未完成，请稍后重试。',
    fieldErrors: {},
    retryable: false,
    cause: error,
  }
}
