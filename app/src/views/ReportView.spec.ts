// @vitest-environment jsdom
import { createApp, h, KeepAlive, nextTick, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView, type RouteLocationNormalizedLoaded } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ReportView from './ReportView.vue'
import LedgerView from './LedgerView.vue'
import CachedPageView from '../components/CachedPageView.vue'
import { usePreferencesStore } from '../stores/preferences'
import { useBootstrapStore } from '../stores/bootstrap'
import { LEDGER_CHANGED_EVENT } from '../api/localEntries'
import { LocalError } from '../domain/localError'
import type { CoreReport } from '../data/reports/reportQueryService'
import { resolveLedgerDateRange } from '../domain/businessDates'
const { core, list } = vi.hoisted(() => ({ core: vi.fn(), list: vi.fn() }))
vi.mock('../api/reports', () => ({ getCoreReport: core, getDimensionReport: core, getReportSummary: vi.fn(), getExpenseReport: vi.fn(), getIncomeReport: vi.fn() }))
vi.mock('../api/ledgerEntries', () => ({ listLedgerEntries: list }))
vi.mock('../components/AppDrawer.vue', () => ({ default: { render: () => null } }))
vi.mock('../components/AppDialog.vue', () => ({ default: { render: () => null } }))
// DOM 只验证状态/路由，图表真实资源和原生触摸在独立模拟器覆盖。
vi.mock('../composables/useReportChart', () => ({ useReportChart: () => ({ host: ref(), token: () => '', numberLabelStyle: () => ({}), refresh: () => {}, failed: ref(false) }) }))
const result: CoreReport = { resolvedRange: { startDate: '2026-11-01', endDate: '2026-11-17' }, summary: { totalIncome: '1000.00', grossExpense: '15.00', adjustmentAmount: '3.00', netExpense: '12.00', balance: '988.00', matchingItemCount: 3,
  dataPoints: [{ label: '总收入', value: 'INCOME', amount: '1000.00', itemCount: 1 }, { label: '原始支出', value: 'EXPENSE', amount: '15.00', itemCount: 1 }, { label: '退款/报销冲减', value: 'ADJUSTMENT', amount: '3.00', itemCount: 1 }] },
  time: { grain: 'WEEK', startDate: '2026-11-01', endDate: '2026-11-17', comparisons: [], buckets: [{ startDate: '2026-11-17', endDate: '2026-11-17', label: '11月17日',
    totalIncome: '1000.00', grossExpense: '15.00', adjustmentAmount: '3.00', netExpense: '12.00', balance: '988.00', cumulativeIncome: '1000.00', cumulativeGrossExpense: '15.00', cumulativeAdjustmentAmount: '3.00', cumulativeNetExpense: '12.00', cumulativeBalance: '988.00', incomeCount: 1, expenseCount: 1, adjustmentCount: 1, itemCount: 3 }] } }
let cleanup = () => {}
const oldScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
async function settle() { for (let i = 0; i < 20; i++) await nextTick() }
beforeEach(() => {
  vi.useFakeTimers()
  core.mockReset().mockResolvedValue(result)
  list.mockReset().mockResolvedValue({ items: [], hasMore: false })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? 0 } })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.useRealTimers()
  if (oldScroll) Object.defineProperty(HTMLElement.prototype, 'scrollTo', oldScroll)
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo
})
async function mount(url = '/reports?scope=ALL&range=THIS_MONTH') {
  const pinia = createPinia(); useBootstrapStore(pinia).datasetId = 'report-dataset'; usePreferencesStore(pinia).status = 'ready'
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/reports', name: 'reports', component: ReportView }, { path: '/ledger', name: 'bill-details', component: LedgerView },
    { path: '/me', name: 'profile-settings', component: { render: () => h('p', '我的') } },
  ] })
  await router.push(url)
  const host = document.createElement('div'); host.className = 'shell-content'; document.body.append(host)
  const app = createApp({ render: () => h(RouterView, null, { default: ({ Component, route }: { Component: unknown, route: RouteLocationNormalizedLoaded }) =>
    h(KeepAlive, null, () => h(CachedPageView, { key: String(route.name), component: Component as never, route })) }) }).use(pinia).use(router)
  cleanup = () => { app.unmount(); host.remove() }; app.mount(host); await settle()
  async function click(button: HTMLButtonElement) {
    const navigated = new Promise<void>(resolve => { const stop = router.afterEach(() => { stop(); resolve() }) })
    button.click(); await navigated; await settle()
  }
  return { host, router, click }
}
function input(host: HTMLElement, value: string) {
  const field = host.querySelector<HTMLInputElement>('#report-search')!; field.value = value; field.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

it.each([
  ['TODAY', '2026-11-22', '2026-11-22'],
  ['THIS_WEEK', '2026-11-16', '2026-11-22'],
  ['THIS_MONTH', '2026-11-01', '2026-11-30'],
  ['THIS_YEAR', '2026-01-01', '2026-12-31'],
  ['LAST_MONTH', '2026-10-01', '2026-10-31'],
] as const)('总览 %s 跨午夜下钻固定已展示快照，返回仍保留原日期条件', async (range, startDate, endDate) => {
  const before = range === 'THIS_YEAR' ? '2026-12-31T15:59:59Z'
    : range === 'THIS_MONTH' || range === 'LAST_MONTH' ? '2026-11-30T15:59:59Z' : '2026-11-22T15:59:59Z'
  vi.setSystemTime(new Date(before))
  core.mockResolvedValue({ ...result, resolvedRange: { startDate, endDate } })
  const { host, router, click } = await mount(`/reports?scope=ALL&range=${range}&dimension=OVERVIEW&q=中文`)
  const count = core.mock.calls.length
  vi.setSystemTime(new Date(Date.parse(before) + 2000)); await settle()
  expect(core.mock.calls).toHaveLength(count)
  await click(host.querySelector<HTMLButtonElement>('[aria-label="查看总收入明细，1条"]')!)
  expect(router.currentRoute.value.query).toMatchObject({ type: 'INCOME', range: 'CUSTOM', startDate, endDate, q: '中文' })
  expect(resolveLedgerDateRange(list.mock.calls.at(-1)![0], new Date())).toEqual([startDate, endDate])
  await click([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('返回报表'))!)
  expect(router.currentRoute.value.query).toMatchObject({ range, dimension: 'OVERVIEW', q: '中文' })
})

// 与原生验收一致：金额相同也要等新时段发布且下钻恢复可用，不能把旧快照算作新粒度。
it.each((['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const)
  .flatMap(grain => ['成功', '失败重试'].map(outcome => ({ grain, outcome }))))('粒度 $grain $outcome：同额旧快照不能通过新粒度验收', async ({ grain, outcome }) => {
  const periods = { DAY: '11月17日', WEEK: '11月16日–11月17日', MONTH: '2026年11月', QUARTER: '2026年Q4', YEAR: '2026年' }
  const initialGrain = grain === 'WEEK' ? 'MONTH' : 'WEEK'
  core.mockResolvedValue({ ...result, time: { ...result.time!, grain: initialGrain, buckets: [{ ...result.time!.buckets[0], label: periods[initialGrain] }] } })
  const { host, router } = await mount(`/reports?scope=ALL&range=THIS_MONTH&dimension=TIME&grain=${initialGrain}&metric=BALANCE`)
  let resolve!: (value: CoreReport) => void, reject!: (error: Error) => void
  const final = { ...result, time: { ...result.time!, grain, buckets: [{ ...result.time!.buckets[0], label: periods[grain] }] } }
  const shownPeriod = () => host.querySelector<HTMLSelectElement>('#time-point')!.selectedOptions[0].textContent
  const snapshotReady = () => shownPeriod() === periods[grain]
    && !host.querySelector<HTMLFieldSetElement>('fieldset.report-result')!.disabled
    && !host.querySelector<HTMLSelectElement>('#time-point')!.matches(':disabled')
  const amounts = () => [...host.querySelectorAll('.time-trend .money-value')].filter(node => node.textContent?.includes('¥988'))
  core.mockReturnValueOnce(new Promise<CoreReport>((done, fail) => { resolve = done; reject = fail }))
  const navigated = new Promise<void>(done => { const stop = router.afterEach(() => { stop(); done() }) })
  const field = host.querySelector<HTMLSelectElement>('#report-grain')!
  field.value = grain; field.dispatchEvent(new Event('change', { bubbles: true })); await navigated; await settle()
  await vi.advanceTimersByTimeAsync(1200); await settle()
  // 三处旧金额始终相同；只有就绪状态及具体时段能拒绝这种误通过。
  expect(field.value).toBe(grain)
  expect(amounts()).toHaveLength(3)
  expect(shownPeriod()).toBe(periods[initialGrain])
  expect(snapshotReady()).toBe(false)
  expect(host.querySelector<HTMLSelectElement>('#time-point')!.matches(':disabled')).toBe(true)
  if (outcome === '失败重试') {
    reject(new LocalError('DATABASE_BUSY', '受控粒度读取失败', { retryable: true })); await settle()
    expect(host.textContent).toContain('报表尚未更新')
    expect(snapshotReady()).toBe(false)
    expect(amounts()).toHaveLength(3)
    core.mockResolvedValueOnce(final)
    const retry = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '重试')!
    retry.click(); await settle()
    expect(core.mock.calls).toHaveLength(3)
  } else {
    resolve(final); await settle()
    expect(core.mock.calls).toHaveLength(2)
  }
  expect(snapshotReady()).toBe(true)
  expect(amounts()).toHaveLength(3)
  expect(host.textContent).not.toContain('报表尚未更新')
  expect(host.querySelector<HTMLButtonElement>(`[aria-label="查看${periods[grain]}的结余明细"]`)!.matches(':disabled')).toBe(false)
})

it.each(['清除', '替换', '离页'])('报表%s取消过时搜索，不污染当前条件/其他页面', async action => {
  const { host, router, click } = await mount('/reports?scope=ALL&range=THIS_YEAR')
  input(host, '旧搜索'); await settle()
  if (action === '清除') await click(host.querySelector<HTMLButtonElement>('[aria-label="清除全部筛选"]')!)
  else await router.replace(action === '替换' ? '/reports?scope=INCOME&range=TODAY&q=新搜索' : '/me')
  await settle(); const path = router.currentRoute.value.fullPath
  await vi.advanceTimersByTimeAsync(1000); await settle()
  expect(router.currentRoute.value.fullPath).toBe(path)
  expect(core.mock.calls.some(([filters]) => filters.query === '旧搜索')).toBe(false)
})
it('时间净支出下钻进入真实明细，返回保留范围/粒度/指标/搜索/位置', async () => {
  const { host, router, click } = await mount('/reports?scope=ALL&range=THIS_MONTH&dimension=TIME&grain=WEEK&metric=NET_EXPENSE&q=中文')
  host.querySelector<HTMLElement>('[data-page-scroll]')!.scrollTop = 300
  await click(host.querySelector<HTMLButtonElement>('[aria-label="查看11月17日的净支出明细"]')!)
  expect(router.currentRoute.value.query).toMatchObject({ type: 'EXPENSE_FLOW', range: 'CUSTOM', startDate: '2026-11-17', endDate: '2026-11-17', q: '中文' })
  expect(list.mock.calls.at(-1)?.[0].type).toBe('EXPENSE_FLOW')
  await click([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('返回报表'))!)
  expect(router.currentRoute.value.query).toMatchObject({ scope: 'ALL', range: 'THIS_MONTH', dimension: 'TIME', grain: 'WEEK', metric: 'NET_EXPENSE', q: '中文', scroll: '300' })
})
it('迟到报表加载不会覆盖返回后用户的新滚动', async () => {
  let release!: (value: CoreReport) => void
  const delayed = new Promise<CoreReport>(resolve => { release = resolve })
  const { host, router } = await mount()
  core.mockReturnValue(delayed)
  await router.replace('/reports?scope=ALL&range=THIS_MONTH&scroll=300')
  await settle(); await vi.advanceTimersByTimeAsync(100)
  const scroll = host.querySelector<HTMLElement>('[data-page-scroll]')!
  scroll.scrollTop = 75
  release(result); await settle()
  expect(scroll.scrollTop).toBe(75)
})
it('后台账目变更刷新；失败保留可信快照并禁止下钻，原重试恢复', async () => {
  const { host } = await mount()
  core.mockRejectedValueOnce(new LocalError('DATABASE_BUSY', '受控读取失败', { retryable: true }))
  globalThis.dispatchEvent(new Event(LEDGER_CHANGED_EVENT)); await settle()
  expect(host.textContent).toContain('报表尚未更新')
  expect(host.querySelector<HTMLFieldSetElement>('fieldset.report-result')!.disabled).toBe(true)
  expect(host.textContent).toContain('¥988')
  const retry = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '重试')!
  retry.click(); await settle()
  expect(host.querySelector<HTMLFieldSetElement>('fieldset.report-result')!.disabled).toBe(false)
  expect(host.textContent).not.toContain('报表尚未更新')
})


it.each([
  ['EXPENSE', 'PURCHASE_CHANNEL', 'UNSPECIFIED', 'missingPurchaseChannel'],
  ['INCOME', 'PAYER', '123e4567-e89b-12d3-a456-426614174000', 'payerId'],
] as const)('%s 多维跨午夜下钻使用原快照和稳定分组，返回保持原范围与维度', async (scope, dimension, value, key) => {
  vi.setSystemTime(new Date('2026-11-20T15:59:59Z'))
  const point = { group: '测试分组', label: '同名显示', value, amount: '15.00', itemCount: 1 }
  const dimensionResult = { ...result, time: undefined,
    resolvedRange: { startDate: '2026-11-20', endDate: '2026-11-20' },
    ...(scope === 'EXPENSE' ? { expense: { dimension, measureLabel: '原始支出（元）', points: [point], truncated: false } }
      : { income: { dimension, measureLabel: '收入金额（元）', points: [point], truncated: false } }) }
  core.mockResolvedValue(dimensionResult)
  const { host, router, click } = await mount(`/reports?scope=${scope}&range=TODAY&dimension=${dimension}`)
  vi.setSystemTime(new Date('2026-11-20T16:00:01Z'))
  await click(host.querySelector<HTMLButtonElement>('.dimension-ranking button')!)
  expect(router.currentRoute.value.query).toMatchObject({ range: 'CUSTOM', startDate: '2026-11-20', endDate: '2026-11-20',
    [key]: value === 'UNSPECIFIED' ? 'true' : value })
  expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ [key]: value === 'UNSPECIFIED' ? true : value })
  const back = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('返回报表'))!
  await click(back)
  expect(router.currentRoute.value.query).toMatchObject({ scope, range: 'TODAY', dimension })
})
