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

const invalidCursor = () => new LocalError('VALIDATION_FAILED', '请检查查询条件。', {
  fieldErrors: [{ field: 'cursor', message: '分页位置无效，请重新加载。' }],
})

it('跨午夜游标失效后从首批恢复已加载深度，后续更多只用新游标', async () => {
  const state = start()
  api.mockResolvedValueOnce(page(['old-a'], 'old-first')).mockResolvedValueOnce(page(['old-b'], 'old-second'))
  await state.replace(filters)
  await state.more()
  api.mockRejectedValueOnce(invalidCursor())
    .mockResolvedValueOnce(page(['new-a'], 'new-first')).mockResolvedValueOnce(page(['new-b'], 'new-second'))
  await state.more()
  expect(api.mock.calls.slice(2).map(call => call[1])).toEqual(['old-second', undefined, 'new-first'])
  expect(state.items.value.map(item => item.id)).toEqual(['new-a', 'new-b'])
  expect(state.status.value).toBe('ready')
  expect(state.staleWarning.value).toBeUndefined()
  api.mockResolvedValueOnce(page(['new-c']))
  await state.more()
  expect(api.mock.calls.at(-1)?.[1]).toBe('new-second')
  expect(state.items.value.map(item => item.id)).toEqual(['new-a', 'new-b', 'new-c'])
})

it('空分页后刷新失败仍显示累计明细，重试成功的真实空账本才显示空态', async () => {
  const state = start()
  api.mockResolvedValueOnce(page(['kept'], 'next')).mockResolvedValueOnce(page([]))
  await state.replace(filters)
  await state.more()
  api.mockRejectedValueOnce(new LocalError('DATABASE_BUSY', '受控读取失败', { retryable: true }))
  await state.refresh()
  expect(state.items.value.map(item => item.id)).toEqual(['kept'])
  expect(state.status.value).toBe('ready')
  expect(state.staleWarning.value?.retryable).toBe(true)
  expect(state.hasMore.value).toBe(false)
  api.mockResolvedValueOnce(page([]))
  await state.retry()
  expect(state.status.value).toBe('empty')
  expect(state.items.value).toEqual([])
  expect(state.staleWarning.value).toBeUndefined()
})

it.each(['retry', 'more'] as const)('游标恢复部分读取失败不发布半页，%s 从首批重试且不再发送旧游标', async action => {
  const state = start()
  api.mockResolvedValueOnce(page(['old-a'], 'old-first')).mockResolvedValueOnce(page(['old-b'], 'old-second'))
  await state.replace(filters)
  await state.more()
  api.mockRejectedValueOnce(invalidCursor()).mockResolvedValueOnce(page(['partial'], 'partial-next'))
    .mockRejectedValueOnce(new LocalError('DATABASE_BUSY', '受控读取失败', { retryable: true }))
  await state.more()
  expect(state.items.value.map(item => item.id)).toEqual(['old-a', 'old-b'])
  expect(state.status.value).toBe('ready')
  expect(state.loadingMore.value).toBe(false)
  expect(state.lastOperation.value).toBe('refresh')
  expect(state.staleWarning.value?.retryable).toBe(true)
  api.mockResolvedValueOnce(page(['new-a'], 'new-first')).mockResolvedValueOnce(page(['new-b']))
  await state[action]()
  expect(api.mock.calls.slice(5).map(call => call[1])).toEqual([undefined, 'new-first'])
  expect(state.items.value.map(item => item.id)).toEqual(['new-a', 'new-b'])
  expect(state.staleWarning.value).toBeUndefined()
})

it.each(['refresh', 'more'] as const)('%s 多页恢复再次跨午夜时停止自动续发，保留快照和可用的重新加载重试', async action => {
  const state = start()
  api.mockResolvedValueOnce(page(['old-a'], 'old-first')).mockResolvedValueOnce(page(['old-b'], 'old-second'))
  await state.replace(filters)
  await state.more()
  if (action === 'more') api.mockRejectedValueOnce(invalidCursor())
  api.mockResolvedValueOnce(page(['partial'], 'expired-next')).mockRejectedValueOnce(invalidCursor())
  await state[action]()
  expect(api).toHaveBeenCalledTimes(action === 'more' ? 5 : 4)
  expect(state.items.value.map(item => item.id)).toEqual(['old-a', 'old-b'])
  expect(state.status.value).toBe('ready')
  expect(state.staleWarning.value?.retryable).toBe(true)
  expect(state.staleWarning.value?.cause).toMatchObject({ code: 'LEDGER_QUERY_RELOAD_REQUIRED' })
  api.mockResolvedValueOnce(page([]))
  await state.retry()
  expect(api.mock.calls.at(-1)?.[1]).toBeUndefined()
  expect(state.status.value).toBe('empty')
})

it('普通条件错误不触发游标恢复，旧请求迟到的游标错误也不刷新新条件', async () => {
  const state = start()
  api.mockResolvedValueOnce(page(['old'], 'old-next'))
  await state.replace(filters)
  api.mockRejectedValueOnce(new LocalError('VALIDATION_FAILED', '无效范围', {
    fieldErrors: [{ field: 'range', message: '无效范围' }],
  }))
  await state.more()
  expect(api).toHaveBeenCalledTimes(2)
  let fail!: (error: unknown) => void
  api.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  const pending = state.more()
  api.mockResolvedValueOnce(page(['current'], 'current-next'))
  await state.replace({ ...filters, type: 'INCOME' })
  fail(invalidCursor())
  await pending
  expect(api).toHaveBeenCalledTimes(4)
  expect(state.items.value.map(item => item.id)).toEqual(['current'])
  expect(state.staleWarning.value).toBeUndefined()
})

it('游标自动恢复中的慢响应不能覆盖替换后的条件', async () => {
  const state = start()
  api.mockResolvedValueOnce(page(['old'], 'old-next'))
  await state.replace(filters)
  let complete!: (value: LedgerPage) => void
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  api.mockRejectedValueOnce(invalidCursor()).mockImplementationOnce(() => new Promise(resolve => {
    complete = resolve
    started()
  }))
  const pending = state.more()
  await entered
  api.mockResolvedValueOnce(page(['current'], 'current-next'))
  await state.replace({ ...filters, query: 'latest' })
  complete(page(['late-recovery']))
  await pending
  expect(state.items.value.map(item => item.id)).toEqual(['current'])
  expect(state.lastOperation.value).toBe('replace')
  expect(state.loadingMore.value).toBe(false)
})
