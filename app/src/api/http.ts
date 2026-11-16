import type { components } from './generated/schema'
export type ApiErrorBody = components['schemas']['ApiError']
/** 迁移期表单错误兼容边界；无网络实现，后续领域任务替换为本地应用服务。 */
export class ApiClientError extends Error {
  constructor(readonly status: number, readonly body?: ApiErrorBody) { super(body?.message ?? '当前操作暂不可用。') }
}
export class ApiTimeoutError extends Error { constructor(readonly timeoutMs: number) { super('本地操作超时。') } }
export interface ApiRequestInit extends RequestInit { timeoutMs?: number }
export async function apiRequest<T>(_operation: string, init: ApiRequestInit = {}): Promise<T> {
  if (init.signal?.aborted) throw new DOMException('操作已取消。', 'AbortError')
  throw new ApiClientError(503, { code: 'FEATURE_UNAVAILABLE', message: '当前版本暂不支持此操作，填写内容会保留。', retryable: false, fieldErrors: {}, traceId: crypto.randomUUID() })
}
