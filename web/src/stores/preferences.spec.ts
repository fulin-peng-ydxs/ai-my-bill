import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useThemeStore } from './theme'
import { usePreferencesStore } from './preferences'

const ACCOUNT = '10000000-0000-4000-8000-000000000001'
const OTHER_ACCOUNT = '20000000-0000-4000-8000-000000000002'
const RESPONSE = {
  defaultFundingChannelId: null,
  ledgerDefaultRange: 'TODAY',
  reportDefaultRange: 'THIS_MONTH',
  themeMode: 'SYSTEM',
  recentEntryType: 'EXPENSE',
  updatedAt: '2026-09-06T00:00:00Z',
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), removeItem: vi.fn(),
  })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', undefined)
})

describe('preferences store', () => {
  it('normalizes an invalid server response and applies the authoritative theme', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...RESPONSE, ledgerDefaultRange: 'FOREVER', themeMode: 'DARK', recentEntryType: 'TRANSFER',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const store = usePreferencesStore()

    await store.initialize(ACCOUNT)

    expect(store.values.ledgerDefaultRange).toBe('TODAY')
    expect(store.values.recentEntryType).toBe('EXPENSE')
    expect(useThemeStore().mode).toBe('dark')
  })

  it('keeps an optimistic session value when saving fails and allows retry', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...RESPONSE, reportDefaultRange: 'THIS_YEAR' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const store = usePreferencesStore()
    store.accountId = ACCOUNT

    await expect(store.update({ reportDefaultRange: 'THIS_YEAR' })).rejects.toThrow('offline')
    expect(store.values.reportDefaultRange).toBe('THIS_YEAR')
    expect(store.fieldStates.reportDefaultRange).toBe('error')
    await store.retry('reportDefaultRange')
    expect(store.fieldStates.reportDefaultRange).toBe('idle')
  })

  it('retains permission classification for failed preference synchronization', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'DENIED', message: '无法修改偏好', retryable: true }), { status: 403, headers: { 'Content-Type': 'application/json' } })))
    const store = usePreferencesStore()
    store.accountId = ACCOUNT
    await expect(store.update({ reportDefaultRange: 'THIS_YEAR' })).rejects.toThrow()
    expect(store.requestError).toMatchObject({ kind: 'forbidden', retryable: false })
    store.discardPending()
    expect(store.requestError).toBeUndefined()
  })

  it('rolls back an optimistic reset when the server rejects it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const store = usePreferencesStore()
    store.accountId = ACCOUNT
    store.values = { ...store.values, themeMode: 'DARK' }

    await expect(store.reset()).rejects.toThrow('offline')

    expect(store.values.themeMode).toBe('DARK')
    expect(useThemeStore().mode).toBe('dark')
  })

  it('ignores a save response that finishes after the active account changes', async () => {
    let resolveSave: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      resolveSave = resolve
    })))
    const store = usePreferencesStore()
    store.accountId = ACCOUNT

    const saving = store.update({ reportDefaultRange: 'THIS_YEAR' })
    await vi.waitFor(() => expect(resolveSave).toBeDefined())
    store.clearMemory()
    store.accountId = OTHER_ACCOUNT
    store.status = 'loading'
    resolveSave?.(new Response(JSON.stringify({ ...RESPONSE, reportDefaultRange: 'THIS_YEAR' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    await saving

    expect(store.accountId).toBe(OTHER_ACCOUNT)
    expect(store.status).toBe('loading')
    expect(store.values.reportDefaultRange).toBe('THIS_MONTH')
  })
})
