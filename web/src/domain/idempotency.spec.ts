import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIdempotencyAttemptTracker } from './idempotency'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('idempotency attempt tracker', () => {
  it('reuses a key for an unchanged retry and rotates it after change or success', () => {
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
    const tracker = createIdempotencyAttemptTracker()
    expect(tracker.keyFor({ amount: '1.00' })).toBe('00000000-0000-4000-8000-000000000001')
    expect(tracker.keyFor({ amount: '1.00' })).toBe('00000000-0000-4000-8000-000000000001')
    expect(tracker.keyFor({ amount: '2.00' })).toBe('00000000-0000-4000-8000-000000000002')
    tracker.reset()
    expect(tracker.keyFor({ amount: '2.00' })).toBe('00000000-0000-4000-8000-000000000003')
    randomUUID.mockRestore()
  })

  it('generates UUID v4 keys on HTTP and preserves retry, change and reset semantics', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xff)
      bytes[0] = getRandomValues.mock.calls.length
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })
    const tracker = createIdempotencyAttemptTracker()
    const first = tracker.keyFor({ amount: '1.00' })
    expect(first).toBe('01ffffff-ffff-4fff-bfff-ffffffffffff')
    expect(tracker.keyFor({ amount: '1.00' })).toBe(first)
    const changed = tracker.keyFor({ amount: '2.00' })
    expect(changed).not.toBe(first)
    expect(changed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    tracker.reset()
    expect(tracker.keyFor({ amount: '2.00' })).not.toBe(changed)
    expect(getRandomValues).toHaveBeenCalledTimes(3)
  })

  it('reports unsupported browsers and allows the same request to retry after recovery', () => {
    vi.stubGlobal('crypto', undefined)
    const tracker = createIdempotencyAttemptTracker()
    expect(() => tracker.keyFor({ amount: '1.00' })).toThrow('当前浏览器暂不支持保存')
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0) })
    expect(tracker.keyFor({ amount: '1.00' })).toBe('00000000-0000-4000-8000-000000000000')
  })
})
