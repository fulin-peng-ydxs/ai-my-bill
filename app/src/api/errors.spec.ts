import { describe, expect, it } from 'vitest'
import { canRetryRequest, normalizeRequestError } from './errors'
import { LocalError } from '../domain/localError'

describe('离线操作错误', () => {
  it('保留字段错误、原因和明确重试资格，不需要 HTTP DTO', () => {
    const cause = new LocalError('VALIDATION_FAILED', '金额不合法。', { fieldErrors: [{ field: 'amount', message: '最多两位小数。' }] })
    const result = normalizeRequestError(cause)
    expect(result.kind).toBe('validation')
    expect(result.fieldErrors).toEqual({ amount: ['最多两位小数。'] })
    expect(result.cause).toBe(cause)
    expect(canRetryRequest(result)).toBe(false)
    expect(canRetryRequest(normalizeRequestError(new LocalError('LOCAL_DATABASE_FAILED', '重试。', { retryable: true })))).toBe(true)
  })
  it('取消和未知运行错误不会产生登录导航或无条件重试', () => {
    const canceled = normalizeRequestError(new DOMException('取消', 'AbortError'))
    expect(canceled.kind).toBe('canceled'); expect(canRetryRequest(canceled)).toBe(false)
    const failed = normalizeRequestError(new TypeError('native bridge'))
    expect(failed.kind).toBe('unexpected'); expect(failed.message).not.toContain('native bridge'); expect(canRetryRequest(failed)).toBe(false)
  })
})
