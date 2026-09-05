import { describe, expect, it } from 'vitest'

import { ApiClientError, ApiTimeoutError } from './http'
import { normalizeRequestError } from './errors'

describe('request error normalization', () => {
  it('keeps the public error contract and field errors', () => {
    const normalized = normalizeRequestError(new ApiClientError(422, {
      code: 'VALIDATION_FAILED',
      message: '请检查输入。',
      fieldErrors: { amount: ['金额格式不正确。'] },
      traceId: 'trace-safe',
      retryable: false,
    }))
    expect(normalized).toMatchObject({
      kind: 'validation',
      message: '请检查输入。',
      fieldErrors: { amount: ['金额格式不正确。'] },
      traceId: 'trace-safe',
      retryable: false,
    })
  })

  it('distinguishes cancelation from a retryable network failure', () => {
    expect(normalizeRequestError(new DOMException('aborted', 'AbortError')).kind).toBe('canceled')
    expect(normalizeRequestError(new TypeError('offline'))).toMatchObject({ kind: 'network', retryable: true })
    expect(normalizeRequestError(new ApiTimeoutError(1000))).toMatchObject({ kind: 'timeout', retryable: true })
  })
})
