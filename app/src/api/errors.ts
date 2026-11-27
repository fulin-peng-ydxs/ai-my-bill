import { LocalError } from '../domain/localError'

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

/** 统一消费明确的重试资格；不从错误文案推断可重试。 */
export function canRetryRequest(error?: RequestError): boolean {
  return Boolean(error?.retryable && !isAccessDenied(error))
}

/** 把本地操作错误统一为页面可安全展示的信息，保留原因链。 */
export function normalizeRequestError(error: unknown): RequestError {
  if (error instanceof LocalError) {
    return {
      kind: error.code === 'OPERATION_CANCELLED' ? 'canceled'
        : error.code === 'VALIDATION_FAILED' || error.code === 'PRODUCT_MERGE_TARGET_INVALID' ? 'validation'
          : error.code.endsWith('_CONFLICT') || error.code === 'ACTIVE_CHILDREN_EXIST' || error.code === 'PARENT_CATEGORY_INACTIVE' ? 'conflict'
            : 'unavailable',
      message: error.message,
      fieldErrors: Object.fromEntries(error.fieldErrors.map(item => [item.field, [item.message]])),
      traceId: error.traceId,
      retryable: error.retryable,
      cause: error,
    }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { kind: 'canceled', message: '请求已取消。', fieldErrors: {}, retryable: false, cause: error }
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
