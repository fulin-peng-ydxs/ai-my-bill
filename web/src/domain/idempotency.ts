/** 同一请求失败重试复用幂等键；请求内容变化或成功后才生成新键。 */
export function createIdempotencyAttemptTracker() {
  let fingerprint = ''
  let key = ''
  return {
    keyFor(request: unknown): string {
      const next = JSON.stringify(request)
      if (!key || next !== fingerprint) key = globalThis.crypto.randomUUID()
      fingerprint = next
      return key
    },
    reset(): void {
      fingerprint = ''
      key = ''
    },
  }
}
