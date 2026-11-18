import { effectScope } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import type { LedgerFilters, LedgerItem, LedgerPage } from '../api/ledgerEntries'
import { listLedgerEntries } from '../api/ledgerEntries'
import { LocalError } from '../domain/localError'
import { useIncrementalLedgerQuery } from './useIncrementalLedgerQuery'
vi.mock('../api/ledgerEntries', () => ({ listLedgerEntries: vi.fn() }))
const filters: LedgerFilters = { query: '', type: 'ALL', lifecycle: 'ACTIVE', range: 'THIS_MONTH' }
const page = (ids: string[], nextCursor?: string): LedgerPage => ({ items: ids.map(id => ({ id } as LedgerItem)), nextCursor, hasMore: Boolean(nextCursor) })
const api = vi.mocked(listLedgerEntries)
let stop = () => {}
function start() {
  const scope = effectScope()
  stop = () => scope.stop()
  return scope.run(useIncrementalLedgerQuery)!
}
afterEach(() => {
  stop()
  vi.resetAllMocks()
})

it('仅刷新已加载深度，去重并消费最新游标；失败保留适用旧结果并可重试', async () => {
  const state = start()
  api.mockResolvedValueOnce(page(['a'], 'first')).mockResolvedValueOnce(page(['b'], 'second'))
  await state.replace(filters)
  await state.more()
  api.mockRejectedValueOnce(new LocalError('DATABASE_BUSY', '受控读取失败', { retryable: true }))
  await state.refresh()
  expect(state.items.value.map(item => item.id)).toEqual(['a', 'b'])
  expect(state.staleWarning.value?.kind).toBe('unavailable')
  api.mockResolvedValueOnce(page(['new', 'a'], 'new-first')).mockResolvedValueOnce(page(['a', 'b'], 'new-second'))
  await state.retry()
  expect(state.items.value.map(item => item.id)).toEqual(['new', 'a', 'b'])
  expect(api.mock.calls.at(-1)?.[1]).toBe('new-first')
  api.mockResolvedValueOnce(page(['c']))
  await state.more()
  expect(api.mock.calls.at(-1)?.[1]).toBe('new-second')
})

it('切换条件期间禁止旧游标加载，旧更多完成不能清掉当前加载锁或污染新结果', async () => {
  const state = start()
  api.mockResolvedValueOnce(page(['old'], 'old-next'))
  await state.replace(filters)
  let oldComplete!: (value: LedgerPage) => void
  api.mockImplementationOnce(() => new Promise(done => { oldComplete = done }))
  const oldMore = state.more()
  api.mockResolvedValueOnce(page(['current'], 'current-next'))
  await state.replace({ ...filters, type: 'INCOME' })
  let newComplete!: (value: LedgerPage) => void
  api.mockImplementationOnce(() => new Promise(done => { newComplete = done }))
  const currentMore = state.more()
  oldComplete(page(['late-old']))
  await oldMore
  expect(state.loadingMore.value).toBe(true)
  const calls = api.mock.calls.length
  await state.more()
  expect(api).toHaveBeenCalledTimes(calls)
  newComplete(page(['new-page']))
  await currentMore
  expect(state.loadingMore.value).toBe(false)
  expect(state.items.value.map(item => item.id)).toEqual(['current', 'new-page'])
})

it('条件替换清除旧结果；慢替换/刷新不能盖过当前条件，替换失败重试同一条件', async () => {
  const state = start()
  api.mockResolvedValueOnce(page(['old'], 'next'))
  await state.replace(filters)
  let complete!: (value: LedgerPage) => void
  api.mockImplementationOnce(() => new Promise(done => { complete = done }))
  const refresh = state.refresh()
  api.mockRejectedValueOnce(new LocalError('DATABASE_BUSY', '受控条件失败', { retryable: true }))
  const replace = state.replace({ ...filters, query: 'new-query' })
  expect(state.items.value).toEqual([])
  expect(state.hasMore.value).toBe(false)
  await state.more()
  await replace
  complete(page(['late-refresh']))
  await refresh
  expect(state.items.value).toEqual([])
  expect(state.status.value).toBe('error')
  api.mockResolvedValueOnce(page(['new-result']))
  await state.retry()
  expect(api.mock.calls.at(-1)?.[0].query).toBe('new-query')
  expect(api.mock.calls.at(-1)?.[1]).toBeUndefined()
  expect(state.items.value.map(item => item.id)).toEqual(['new-result'])
})

it('慢替换期间不能用旧游标中断新查询，旧替换晚返回被丢弃', async () => {
  const state = start()
  let complete!: (value: LedgerPage) => void
  api.mockImplementationOnce(() => new Promise(done => { complete = done }))
  const first = state.replace(filters)
  api.mockResolvedValueOnce(page(['latest'], 'latest-next'))
  await state.replace({ ...filters, lifecycle: 'TRASHED' })
  complete(page(['stale'], 'stale-next'))
  await first
  expect(state.items.value.map(item => item.id)).toEqual(['latest'])
})
