import { LocalError } from '../domain/localError'

/** 本地应用边界保留完整原因链，页面沿用字段错误/重试组件，不展示原生 SQL 或堆栈。 */
export async function localOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (cause) {
    if (cause instanceof LocalError || cause instanceof Error && cause.name === 'AbortError') {
      throw cause
    }
    throw new LocalError('LOCAL_DATABASE_FAILED', '本地操作未完成，请保留输入后重试。', {
      retryable: !(cause instanceof AggregateError),
      cause,
    })
  }
}
