import { describe, expect, it, vi } from 'vitest'
import { createIdempotencyAttemptTracker } from './idempotency'

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
})
