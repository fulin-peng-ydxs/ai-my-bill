import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accountStorageSupportProblem, clearAccountStorage, readAccountStorage, writeAccountStorage } from './accountStorage'

const ACCOUNT_A = '10000000-0000-4000-8000-000000000001'
const ACCOUNT_B = '10000000-0000-4000-8000-000000000002'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  }
}

beforeEach(() => vi.unstubAllGlobals())

describe('account storage', () => {
  it('uses opaque account namespaces and never enumerates storage', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)

    await writeAccountStorage(ACCOUNT_A, 'preferences', '{"theme":"dark"}')

    const [key] = [...storage.values.keys()]
    expect(key).toMatch(/^my-bill:account:v1:[0-9a-f]{64}:preferences$/)
    expect(key).not.toContain(ACCOUNT_A)
    expect(storage.getItem).not.toHaveBeenCalledWith(expect.stringContaining(ACCOUNT_B))
    expect(await readAccountStorage(ACCOUNT_B, 'preferences')).toBeUndefined()
  })

  it('clears only known keys for the confirmed account', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    await writeAccountStorage(ACCOUNT_A, 'draft:EXPENSE', 'expense')
    await writeAccountStorage(ACCOUNT_A, 'draft:INCOME', 'income')
    await writeAccountStorage(ACCOUNT_A, 'preferences', 'prefs')
    await writeAccountStorage(ACCOUNT_B, 'draft:EXPENSE', 'other')

    await clearAccountStorage(ACCOUNT_A)

    expect(await readAccountStorage(ACCOUNT_A, 'draft:EXPENSE')).toBeUndefined()
    expect(await readAccountStorage(ACCOUNT_B, 'draft:EXPENSE')).toBe('other')
  })

  it('fails closed instead of using a raw invalid account id', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    expect(await writeAccountStorage('alice', 'preferences', '{}')).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('explains an unsupported HTTP test address without weakening account isolation', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('crypto', {})
    vi.stubGlobal('isSecureContext', false)
    expect(accountStorageSupportProblem()).toContain('HTTPS')
    expect(await writeAccountStorage(ACCOUNT_A, 'draft:EXPENSE', 'draft')).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('does not break restoration when the browser rejects hashing or local storage', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockRejectedValue(new Error('unavailable')) } })
    expect(await readAccountStorage(ACCOUNT_A, 'draft:EXPENSE')).toBeUndefined()
    expect(await writeAccountStorage(ACCOUNT_A, 'draft:EXPENSE', 'draft')).toBe(false)
  })
  it('handles a browser that denies access to the local storage property itself', async () => {
    vi.stubGlobal('localStorage', undefined)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied') } })
    expect(accountStorageSupportProblem()).toContain('未允许')
    expect(await readAccountStorage(ACCOUNT_A, 'draft:EXPENSE')).toBeUndefined()
    expect(await writeAccountStorage(ACCOUNT_A, 'draft:EXPENSE', 'draft')).toBe(false)
    await expect(clearAccountStorage(ACCOUNT_A)).resolves.toBeUndefined()
  })
})
