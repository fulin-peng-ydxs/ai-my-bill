import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LedgerFilters, LedgerItem, LedgerPage } from '../api/ledgerEntries'
import { listLedgerEntries } from '../api/ledgerEntries'
import { ApiClientError } from '../api/http'
import { useIncrementalLedgerQuery } from './useIncrementalLedgerQuery'

vi.mock('../api/ledgerEntries', () => ({ listLedgerEntries: vi.fn() }))
const filters: LedgerFilters = { query: '', type: 'ALL', lifecycle: 'ACTIVE', range: 'THIS_MONTH' }
const item = (id: string) => ({ id } as LedgerItem)
const page = (ids: string[], nextCursor?: string): LedgerPage => ({ items: ids.map(item), nextCursor, hasMore: Boolean(nextCursor) })
afterEach(() => vi.resetAllMocks())

describe('cached ledger refresh', () => {
  it.each([401, 403])('clears accumulated ledger pages when access fails with %i', async (code) => {
    const scope = effectScope()
    const state = scope.run(useIncrementalLedgerQuery)!
    vi.mocked(listLedgerEntries).mockResolvedValueOnce(page(['private'], 'next'))
    await state.replace(filters)
    vi.mocked(listLedgerEntries).mockRejectedValueOnce(new ApiClientError(code))
    await state.refresh()
    expect(state.items.value).toEqual([])
    expect(state.hasMore.value).toBe(false)
    expect(state.status.value).toBe('error')
    expect(state.error.value?.kind).toBe(code === 401 ? 'unauthorized' : 'forbidden')
    scope.stop()
  })
  it('refreshes exactly the loaded depth, deduplicates and retains the next cursor', async () => {
    const scope = effectScope()
    const state = scope.run(useIncrementalLedgerQuery)!
    const api = vi.mocked(listLedgerEntries)
    api.mockResolvedValueOnce(page(['a'], 'first')).mockResolvedValueOnce(page(['b'], 'second'))
    await state.replace(filters)
    await state.more()
    api.mockResolvedValueOnce(page(['new', 'a'], 'new-first')).mockResolvedValueOnce(page(['a', 'b'], 'new-second'))
    await state.refresh()
    expect(state.items.value.map((value) => value.id)).toEqual(['new', 'a', 'b'])
    expect(api).toHaveBeenCalledTimes(4)
    expect(api.mock.calls[3]?.[1]).toBe('new-first')
    api.mockResolvedValueOnce(page(['c']))
    await state.more()
    expect(api.mock.calls[4]?.[1]).toBe('new-second')
    scope.stop()
  })
  it('keeps the loaded list after a failed return refresh', async () => {
    const scope = effectScope()
    const state = scope.run(useIncrementalLedgerQuery)!
    vi.mocked(listLedgerEntries).mockResolvedValueOnce(page(['a'])).mockRejectedValueOnce(new TypeError('offline'))
    await state.replace(filters)
    await state.refresh()
    expect(state.items.value.map((value) => value.id)).toEqual(['a'])
    expect(state.status.value).toBe('ready')
    expect(state.staleWarning.value?.kind).toBe('network')
    expect(state.error.value).toBeUndefined()
    vi.mocked(listLedgerEntries).mockResolvedValueOnce(page(['updated']))
    await state.retry()
    expect(state.items.value.map((value) => value.id)).toEqual(['updated'])
    expect(vi.mocked(listLedgerEntries).mock.calls.at(-1)?.[1]).toBeUndefined()
    scope.stop()
  })
  it('drops a late refresh response after a different filter replaces the list', async () => {
    const scope = effectScope()
    const state = scope.run(useIncrementalLedgerQuery)!
    const api = vi.mocked(listLedgerEntries)
    api.mockResolvedValueOnce(page(['a']))
    await state.replace(filters)
    let resolve!: (result: LedgerPage) => void
    api.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const pending = state.refresh()
    api.mockResolvedValueOnce(page(['current']))
    await state.replace({ ...filters, range: 'TODAY' })
    resolve(page(['old']))
    await pending
    expect(state.items.value.map((value) => value.id)).toEqual(['current'])
    scope.stop()
  })
})
