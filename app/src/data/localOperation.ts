import { LocalError } from '../domain/localError'

/** 本地应用边界保留完整原因链，页面沿用字段错误/重试组件，不展示原生 SQL 或堆栈。 */
export async function localOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (cause) {
    if (cause instanceof LocalError || cause instanceof Error && cause.name === 'AbortError') {
      throw cause
    }
    const fileCodes: Record<string, [string, boolean]> = {
      BACKUP_AUTHENTICATION_FAILED: ['备份密码不正确或文件已损坏。', false],
      BACKUP_INCOMPATIBLE: ['备份格式、版本或密码参数不兼容。', false],
      BACKUP_INVALID: ['备份内容或文件完整性校验未通过。', false],
      OPERATION_CANCELLED: ['操作已取消。', false],
      DATA_OPERATION_CONFLICT: ['数据文件状态已改变，请重新选择或打开账本。', true],
      DATA_FILE_FAILED: ['文件操作未完成，请检查可用空间和文件权限后重试。', true],
    }
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
    if (Object.hasOwn(fileCodes, code)) {
      const [message,retryable] = fileCodes[code]
      throw new LocalError(code,message,{ retryable,cause })
    }
    throw new LocalError('LOCAL_DATABASE_FAILED', '本地操作未完成，请保留输入后重试。', {
      retryable: !(cause instanceof AggregateError),
      cause,
    })
  }
}
