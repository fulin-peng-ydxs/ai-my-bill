import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { confirmDiscardChanges, requestDiscardChanges } from './unsavedChanges'
import { LEDGER_DRAFT_TTL_MS, readLedgerDraft, useLedgerDraft, writeLedgerDraft } from './useLedgerDraft'

const ACCOUNT = '10000000-0000-4000-8000-000000000001'
const OTHER_ACCOUNT = '20000000-0000-4000-8000-000000000002'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

beforeEach(() => vi.unstubAllGlobals())

describe('ledger draft storage', () => {
  it('round-trips expense and income independently and strips unknown fields', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    await writeLedgerDraft(ACCOUNT, 'EXPENSE', { productName: '咖啡', amount: 'secret' }, 1_000)
    await writeLedgerDraft(ACCOUNT, 'INCOME', { incomeName: '稿费', productName: 'secret' }, 1_000)

    expect(await readLedgerDraft(ACCOUNT, 'EXPENSE', 1_001)).toEqual({ productName: '咖啡' })
    expect(await readLedgerDraft(ACCOUNT, 'INCOME', 1_001)).toEqual({ incomeName: '稿费' })
  })

  it('keeps a draft just before seven days and deletes it at the boundary', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    await writeLedgerDraft(ACCOUNT, 'EXPENSE', { productName: '咖啡' }, 1_000)

    expect(await readLedgerDraft(ACCOUNT, 'EXPENSE', 1_000 + LEDGER_DRAFT_TTL_MS - 1)).toBeDefined()
    expect(await readLedgerDraft(ACCOUNT, 'EXPENSE', 1_000 + LEDGER_DRAFT_TTL_MS)).toBeUndefined()
    expect(storage.values.size).toBe(0)
  })

  it('deletes incompatible, malformed and future-dated records precisely', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    await writeLedgerDraft(ACCOUNT, 'INCOME', { incomeName: '稿费' }, 2_000)
    const [key] = [...storage.values.keys()]
    storage.values.set(key, JSON.stringify({
      schemaVersion: 2, type: 'INCOME', createdAt: new Date(2_000).toISOString(),
      updatedAt: new Date(2_000).toISOString(), data: { incomeName: '稿费' },
    }))

    expect(await readLedgerDraft(ACCOUNT, 'INCOME', 2_001)).toBeUndefined()
    expect(storage.values.has(key)).toBe(false)
  })

  it('stores no account, tenant, username, token, or submitted collection', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    await writeLedgerDraft(ACCOUNT, 'EXPENSE', {
      productName: '咖啡', tenantId: 'tenant', username: 'alice', token: 'token', items: 'response',
    })
    const serialized = [...storage.values.values()][0]
    expect(serialized).not.toContain(ACCOUNT)
    expect(serialized).not.toContain('tenant')
    expect(serialized).not.toContain('alice')
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('response')
  })

  it('clears memory but keeps the device draft after confirmed logout', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const scope = effectScope()
    const draft = scope.run(() => useLedgerDraft(ref(ACCOUNT), ref('EXPENSE' as const)))
    expect(draft).toBeDefined()
    await draft?.restore()
    await draft?.replace({ productName: '咖啡' })

    const leaving = requestDiscardChanges('logout')
    await confirmDiscardChanges()

    expect(await leaving).toBe(true)
    expect(draft?.data.value).toEqual({})
    expect(await readLedgerDraft(ACCOUNT, 'EXPENSE')).toEqual({ productName: '咖啡' })
    scope.stop()
  })

  it('clears the in-memory draft before restoring another account', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const accountId = ref<string | undefined>(ACCOUNT)
    const scope = effectScope()
    const draft = scope.run(() => useLedgerDraft(accountId, ref('EXPENSE' as const)))
    await draft?.restore()
    await draft?.replace({ productName: '咖啡' })

    accountId.value = OTHER_ACCOUNT
    await nextTick()

    expect(draft?.data.value).toEqual({})
    scope.stop()
  })
})
