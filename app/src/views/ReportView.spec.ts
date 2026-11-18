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
const { core, list } = vi.hoisted(() => ({ core: vi.fn(), list: vi.fn() }))
vi.mock('../api/reports', () => ({ getCoreReport: core, getReportSummary: vi.fn(), getExpenseReport: vi.fn(), getIncomeReport: vi.fn() }))
vi.mock('../api/ledgerEntries', () => ({ listLedgerEntries: list }))
vi.mock('../components/AppDrawer.vue', () => ({ default: { render: () => null } }))
vi.mock('../components/AppDialog.vue', () => ({ default: { render: () => null } }))
// DOM 只验证状态/路由，图表真实资源和原生触摸在独立模拟器覆盖。
vi.mock('../composables/useReportChart', () => ({ useReportChart: () => ({ host: ref(), token: () => '', numberLabelStyle: () => ({}), refresh: () => {}, failed: ref(false) }) }))
const result: CoreReport = { summary: { totalIncome: '1000.00', grossExpense: '15.00', adjustmentAmount: '3.00', netExpense: '12.00', balance: '988.00', matchingItemCount: 3,
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
