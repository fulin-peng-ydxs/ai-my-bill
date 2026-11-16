export type FieldError = Readonly<{ field: string; message: string }>

/** 本地错误只公开可供原有表单/提示组件消费的字段，底层原因留在错误链。 */
export class LocalError extends Error {
  readonly traceId = crypto.randomUUID()
  readonly code: string
  readonly retryable: boolean
  readonly fieldErrors: readonly FieldError[]

  constructor(code: string, message: string, options: {
    retryable?: boolean
    fieldErrors?: readonly FieldError[]
    cause?: unknown
  } = {}) {
    super(message, { cause: options.cause })
    this.name = 'LocalError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.fieldErrors = Object.freeze([...(options.fieldErrors ?? [])].map((value) => Object.freeze({ ...value })))
  }

  toJSON() {
    return { traceId: this.traceId, code: this.code, message: this.message, retryable: this.retryable, fieldErrors: this.fieldErrors }
  }
}

/** 取消只在操作开始前或事务提交前生效，不能把已提交结果伪装成失败。 */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LocalError('OPERATION_CANCELLED', '操作已取消。')
}
