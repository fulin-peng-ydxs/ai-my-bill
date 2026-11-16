/** 局域网 HTTP 没有 randomUUID，但仍可使用密码学随机字节生成 UUID v4。 */
function createRequestKey(): string {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('当前浏览器暂不支持保存，请使用 HTTPS 地址或更新浏览器后重试。')
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 同一请求失败重试复用幂等键；请求内容变化或成功后才生成新键。 */
export function createIdempotencyAttemptTracker() {
  let fingerprint = ''
  let key = ''
  return {
    keyFor(request: unknown): string {
      const next = JSON.stringify(request)
      if (!key || next !== fingerprint) key = createRequestKey()
      fingerprint = next
      return key
    },
    reset(): void {
      fingerprint = ''
      key = ''
    },
  }
}
