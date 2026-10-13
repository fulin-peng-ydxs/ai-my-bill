import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { confirmDiscardChanges, requestDiscardChanges } from './unsavedChanges'
import { LEDGER_DRAFT_TTL_MS, readLedgerDraft, useLedgerDraft, writeLedgerDraft } from './useLedgerDraft'
import { createExpenseProductSelection } from '../domain/expenseProductSelection'
import { emptyExpenseForm } from '../domain/ledgerEntryForm'

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
  it('persists bounded expense ownership without adding form fields or leaking it into income drafts', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const form = emptyExpenseForm('wechat')
    const selection = createExpenseProductSelection(form)
    selection.select({ id: 'product', name: '咖啡', unitId: 'cup', lastUnitPrice: '16' })
    const productSelectionState = selection.serialize()
    await writeLedgerDraft(ACCOUNT, 'EXPENSE', { ...form, productSelectionState })
    const stored = await readLedgerDraft(ACCOUNT, 'EXPENSE')
    const { productSelectionState: state, ...fields } = stored!
    const restoredForm = Object.assign(emptyExpenseForm(), fields)
    const restoredSelection = createExpenseProductSelection(restoredForm)
    restoredSelection.restore(state)
    restoredSelection.clear()
    expect(restoredForm.unitPrice).toBe('')
    expect(restoredForm.paidAmount).toBe('')
    expect(restoredForm).not.toHaveProperty('productSelectionState')
    await writeLedgerDraft(ACCOUNT, 'INCOME', { incomeName: '稿费', productSelectionState })
    expect(await readLedgerDraft(ACCOUNT, 'INCOME')).toEqual({ incomeName: '稿费' })
  })

  it('keeps legacy fields when ownership metadata is malformed and does not persist metadata alone', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    await writeLedgerDraft(ACCOUNT, 'EXPENSE', { productName: '咖啡', unitPrice: '16', productSelectionState: '{' })
    expect(await readLedgerDraft(ACCOUNT, 'EXPENSE')).toEqual({ productName: '咖啡', unitPrice: '16' })
    await writeLedgerDraft(ACCOUNT, 'EXPENSE', { productSelectionState: createExpenseProductSelection(emptyExpenseForm()).serialize() })
    expect(await readLedgerDraft(ACCOUNT, 'EXPENSE')).toBeUndefined()
  })

  it('round-trips expense and income independently and strips unknown fields', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    await writeLedgerDraft(ACCOUNT, 'EXPENSE', {
      productName: '咖啡', primaryCategoryId: 'primary', secondaryCategoryId: 'secondary', amount: 'secret',
    }, 1_000)
    await writeLedgerDraft(ACCOUNT, 'INCOME', { incomeName: '稿费', productName: 'secret' }, 1_000)

    expect(await readLedgerDraft(ACCOUNT, 'EXPENSE', 1_001)).toEqual({
      productName: '咖啡', primaryCategoryId: 'primary', secondaryCategoryId: 'secondary',
    })
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

  it('enforces field limits by Unicode code points', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const fiveHundredEmoji = '🥤'.repeat(500)

    await writeLedgerDraft(ACCOUNT, 'EXPENSE', { note: fiveHundredEmoji })
    expect(await readLedgerDraft(ACCOUNT, 'EXPENSE')).toEqual({ note: fiveHundredEmoji })

    await writeLedgerDraft(ACCOUNT, 'EXPENSE', { note: `${fiveHundredEmoji}🥤` })
    expect(await readLedgerDraft(ACCOUNT, 'EXPENSE')).toBeUndefined()
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
  it('retains current input after a failed backup and retries the latest data without submitting a bill', async () => {
    const storage = memoryStorage()
    let rejected = true
    vi.stubGlobal('localStorage', { ...storage, setItem: (key: string, value: string) => {
      if (rejected) throw new Error('quota')
      storage.setItem(key, value)
    } })
    const scope = effectScope()
    const draft = scope.run(() => useLedgerDraft(ref(ACCOUNT), ref('EXPENSE' as const)))!
    await draft.restore()
    await draft.replace({ productName: '咖啡', paidAmount: '16.00' })
    expect(draft.storageError.value).toBeDefined()
    expect(draft.data.value.paidAmount).toBe('16.00')
    rejected = false
    await draft.retryBackup()
    expect(draft.storageError.value).toBeUndefined()
    expect(await readLedgerDraft(ACCOUNT, 'EXPENSE')).toEqual({ productName: '咖啡', paidAmount: '16.00' })
    scope.stop()
  })
})
