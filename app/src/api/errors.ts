import { LocalError } from '../domain/localError'
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

export function isAccessDenied(error?: RequestError): boolean {
  return error?.kind === 'forbidden' || error?.kind === 'unauthorized'
}

/** 统一消费明确的重试资格；旧 DTO 的身份状态仅保留类型兼容，App 不产生身份请求。 */
export function canRetryRequest(error?: RequestError): boolean {
  return Boolean(error?.retryable && !isAccessDenied(error))
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

/** 把本地操作和兼容 DTO 错误统一为页面可安全展示的信息，保留原因链。 */
export function normalizeRequestError(error: unknown): RequestError {
  if (error instanceof LocalError) return { kind: 'unavailable', message: error.message, fieldErrors: Object.fromEntries(error.fieldErrors.map(item => [item.field, [item.message]])), traceId: error.traceId, retryable: error.retryable, cause: error }
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
      retryable: error.status !== 401 && error.status !== 403 && (error.body?.retryable ?? error.status >= 500),
      cause: error,
    }
  }
  if (error instanceof TypeError) {
    return { kind: 'unexpected', message: '本地操作未完成，请保留填写内容后重试。', fieldErrors: {}, retryable: false, cause: error }
  }
  return {
    kind: 'unexpected',
    message: error instanceof Error ? error.message : '请求未完成，请稍后重试。',
    fieldErrors: {},
    retryable: false,
    cause: error,
  }
}
