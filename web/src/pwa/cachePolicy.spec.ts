import { describe, expect, it } from 'vitest'

import { isApiOrDownloadPath, isCacheableStaticAsset } from './cachePolicy'

describe('PWA cache policy', () => {
  it('never classifies API or download paths as cacheable data', () => {
    expect(isApiOrDownloadPath('/api/v1/auth/session')).toBe(true)
    expect(isApiOrDownloadPath('/downloads/export.csv')).toBe(true)
    expect(isApiOrDownloadPath('/entry')).toBe(false)
  })

  it('accepts only same-origin content-hashed static assets', () => {
    const origin = 'https://bill.example.test'
    expect(isCacheableStaticAsset(new URL(`${origin}/assets/app-Abcdef12.js`), origin)).toBe(true)
    expect(isCacheableStaticAsset(new URL(`${origin}/assets/app.js`), origin)).toBe(false)
    expect(isCacheableStaticAsset(new URL(`${origin}/entry`), origin)).toBe(false)
    expect(isCacheableStaticAsset(new URL('https://other.test/assets/app-Abcdef12.js'), origin)).toBe(false)
  })
})
