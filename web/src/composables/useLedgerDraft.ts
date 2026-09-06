import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

import type { EntryType } from '../domain/preferences'
import { unicodeCodePointLength } from '../domain/text'
import { readAccountStorage, removeAccountStorage, writeAccountStorage } from '../storage/accountStorage'
import { registerAccountMemoryCleanup } from './accountMemory'
import { notifyUnsavedChangesChanged, registerUnsavedChanges } from './unsavedChanges'

export const LEDGER_DRAFT_SCHEMA_VERSION = 1
export const LEDGER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_DRAFT_BYTES = 16 * 1024

const FIELD_LIMITS = {
  EXPENSE: {
    productId: 36, productName: 200, primaryCategoryId: 36,
    secondaryCategoryId: 36, unitId: 36,
    unitPrice: 32, quantity: 32, paidAmount: 32, fundingChannelId: 36,
    purchaseChannelId: 36, locationLabelId: 36, occurredAt: 40, note: 500,
  },
  INCOME: {
    incomeName: 200, payerId: 36, payerName: 200, incomeCategoryId: 36,
    amount: 32, fundingChannelId: 36, occurredAt: 40, note: 500,
  },
} as const

export type LedgerDraftData = Record<string, string>

interface StoredLedgerDraft {
  schemaVersion: number
  type: EntryType
  createdAt: string
  updatedAt: string
  data: LedgerDraftData
}

function scope(type: EntryType): `draft:${EntryType}` {
  return `draft:${type}`
}

function sanitize(type: EntryType, value: unknown): LedgerDraftData {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>
  return Object.fromEntries(Object.entries(FIELD_LIMITS[type]).flatMap(([field, limit]) => {
    const candidate = source[field]
    return typeof candidate === 'string'
      && unicodeCodePointLength(candidate) <= limit
      && unicodeCodePointLength(candidate) > 0
      ? [[field, candidate]]
      : []
  }))
}

async function readStoredLedgerDraft(
  accountId: string,
  type: EntryType,
  now = Date.now(),
): Promise<{ data: LedgerDraftData, createdAt: number } | undefined> {
  const raw = await readAccountStorage(accountId, scope(type))
  if (!raw) return undefined
  if (new TextEncoder().encode(raw).byteLength > MAX_DRAFT_BYTES) {
    await removeAccountStorage(accountId, scope(type))
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredLedgerDraft>
    const createdAt = Date.parse(parsed.createdAt ?? '')
    const updatedAt = Date.parse(parsed.updatedAt ?? '')
    const invalid = parsed.schemaVersion !== LEDGER_DRAFT_SCHEMA_VERSION
      || parsed.type !== type
      || !Number.isFinite(createdAt)
      || !Number.isFinite(updatedAt)
      || createdAt > updatedAt
      || updatedAt > now
      || now - updatedAt >= LEDGER_DRAFT_TTL_MS
    if (invalid) {
      await removeAccountStorage(accountId, scope(type))
      return undefined
    }
    const data = sanitize(type, parsed.data)
    if (Object.keys(data).length === 0) {
      await removeAccountStorage(accountId, scope(type))
      return undefined
    }
    return { data, createdAt }
  } catch {
    await removeAccountStorage(accountId, scope(type))
    return undefined
  }
}

export async function readLedgerDraft(
  accountId: string,
  type: EntryType,
  now = Date.now(),
): Promise<LedgerDraftData | undefined> {
  return (await readStoredLedgerDraft(accountId, type, now))?.data
}

export async function writeLedgerDraft(
  accountId: string,
  type: EntryType,
  data: LedgerDraftData,
  now = Date.now(),
  createdAt = now,
): Promise<boolean> {
  const safeData = sanitize(type, data)
  if (Object.keys(safeData).length === 0) {
    await removeAccountStorage(accountId, scope(type))
    return true
  }
  const stored: StoredLedgerDraft = {
    schemaVersion: LEDGER_DRAFT_SCHEMA_VERSION,
    type,
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(now).toISOString(),
    data: safeData,
  }
  const serialized = JSON.stringify(stored)
  if (new TextEncoder().encode(serialized).byteLength > MAX_DRAFT_BYTES) return false
  return writeAccountStorage(accountId, scope(type), serialized)
}

export async function removeLedgerDraft(accountId: string, type: EntryType): Promise<void> {
  await removeAccountStorage(accountId, scope(type))
}

/** T11/T12 表单共用：类型切换只换当前视图，不覆盖另一类型草稿。 */
export function useLedgerDraft(accountId: Ref<string | undefined>, type: Ref<EntryType>) {
  const data = ref<LedgerDraftData>({})
  const restored = ref(false)
  const storageError = ref<string>()
  let createdAt = Date.now()
  let operation = Promise.resolve()
  let restoreRevision = 0

  const dirty = computed(() => Object.keys(data.value).length > 0)
  const stopMemoryCleanup = registerAccountMemoryCleanup((removedAccountId) => {
    if (removedAccountId === accountId.value) {
      data.value = {}
      restored.value = false
      notifyUnsavedChangesChanged()
    }
  })
  const stopUnsaved = registerUnsavedChanges(dirty, async (reason) => {
    const currentAccount = accountId.value
    if (currentAccount && reason === 'navigation') {
      await operation.catch(() => undefined)
      await removeLedgerDraft(currentAccount, type.value)
    }
    data.value = {}
    restored.value = false
    notifyUnsavedChangesChanged()
  })

  async function restore(): Promise<void> {
    const requestRevision = ++restoreRevision
    const currentAccount = accountId.value
    const currentType = type.value
    const stored = currentAccount ? await readStoredLedgerDraft(currentAccount, currentType) : undefined
    if (requestRevision !== restoreRevision || currentAccount !== accountId.value || currentType !== type.value) return
    data.value = stored?.data ?? {}
    createdAt = stored?.createdAt ?? Date.now()
    restored.value = true
    storageError.value = undefined
    notifyUnsavedChangesChanged()
  }

  function replace(next: LedgerDraftData): Promise<void> {
    data.value = sanitize(type.value, next)
    notifyUnsavedChangesChanged()
    const currentAccount = accountId.value
    const currentType = type.value
    const snapshot = { ...data.value }
    const draftCreatedAt = createdAt
    if (!currentAccount) return Promise.resolve()
    operation = operation.catch(() => undefined).then(async () => {
      try {
        const saved = await writeLedgerDraft(currentAccount, currentType, snapshot, Date.now(), draftCreatedAt)
        if (currentAccount === accountId.value && currentType === type.value) {
          storageError.value = saved ? undefined : '草稿暂时无法保存在此设备。'
        }
      } catch {
        if (currentAccount === accountId.value && currentType === type.value) {
          storageError.value = '草稿暂时无法保存在此设备。'
        }
      }
    })
    return operation
  }

  async function clear(): Promise<void> {
    const currentAccount = accountId.value
    const currentType = type.value
    const requestRevision = ++restoreRevision
    await operation.catch(() => undefined)
    if (currentAccount) await removeLedgerDraft(currentAccount, currentType)
    if (requestRevision === restoreRevision
      && currentAccount === accountId.value && currentType === type.value) {
      data.value = {}
      restored.value = false
      notifyUnsavedChangesChanged()
    }
  }

  watch([accountId, type], () => {
    restoreRevision += 1
    data.value = {}
    restored.value = false
    storageError.value = undefined
    notifyUnsavedChangesChanged()
    void restore()
  }, { immediate: true })
  onScopeDispose(() => {
    stopMemoryCleanup()
    stopUnsaved()
  })

  return { data, dirty, restored, storageError, restore, replace, clear }
}
