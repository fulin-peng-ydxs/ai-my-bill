// @vitest-environment jsdom
import { createApp, defineComponent, h, KeepAlive, nextTick, provide, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type RouteLocationNormalizedLoaded } from 'vue-router'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GlobalLedgerSearch from './GlobalLedgerSearch.vue'
import CachedPageView from './CachedPageView.vue'
import LedgerView from '../views/LedgerView.vue'
import { pageActivityKey } from '../composables/usePageActivity'
import { useBootstrapStore } from '../stores/bootstrap'
import { usePreferencesStore } from '../stores/preferences'
import type { LedgerItem } from '../api/ledgerEntries'
import { LEDGER_CHANGED_EVENT } from '../api/localEntries'
import { LocalError } from '../domain/localError'

const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../api/ledgerEntries', () => ({ listLedgerEntries: list }))
// 本组只操作真实页头与搜索，关闭的编辑/危险确认不参与本次链路。
vi.mock('./AppDrawer.vue', () => ({ default: { render: () => null } }))
vi.mock('./AppDialog.vue', () => ({ default: { render: () => null } }))
let cleanup = () => {}
const oldScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
async function settle() {
  for (let index = 0; index < 15; index++) await nextTick()
}
beforeEach(() => {
  vi.useFakeTimers()
  list.mockReset().mockResolvedValue({ items: [], hasMore: false })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup()
  if (oldScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', oldScrollTo)
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function inputEvent(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
}
async function mountLedger() {
  const pinia = createPinia()
  useBootstrapStore(pinia).datasetId = 'search-regression'
  usePreferencesStore(pinia).status = 'ready'
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/ledger', name: 'bill-details', component: LedgerView },
    { path: '/me', name: 'profile-settings', component: { render: () => h('p', '我的') } },
  ] })
  await router.push('/ledger?type=ALL&range=THIS_MONTH')
  const host = document.createElement('div')
  host.className = 'shell-content'
  document.body.append(host)
  const app = createApp({ render: () => h(RouterView, null, {
    default: ({ Component, route }: { Component: unknown; route: RouteLocationNormalizedLoaded }) =>
      h(KeepAlive, { max: 2 }, () => h(CachedPageView, { key: String(route.name), component: Component as never, route })),
  }) }).use(pinia).use(router)
  cleanup = () => { app.unmount(); host.remove() }
  app.mount(host)
  await settle()
  return { host, router, input: host.querySelector<HTMLInputElement>('#ledger-search')! }
}

const ledgerItem = (id: string): LedgerItem => ({ id, entryType: 'INCOME', title: id, categoryName: '工资',
  counterpartyName: '合成公司', fundingChannelName: '现金', amount: '1.00', occurredAt: '2026-11-17T01:00:00Z',
  businessDate: '2026-11-17', createdAt: '2026-11-17T01:00:00Z', version: 1, lifecycleStatus: 'ACTIVE',
  adjustmentType: null, originalExpenseId: null, effectiveAdjustmentAmount: null, netExpenseAmount: null,
  fullyAdjusted: false, linkedAdjustmentCount: 0 })
const busy = () => new LocalError('DATABASE_BUSY', '受控读取失败', { retryable: true })
function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)
  expect(found).toBeTruthy()
  return found!
}

it('真实明细空分页后刷新失败保留列表，原重试入口可恢复', async () => {
  list.mockResolvedValueOnce({ items: [ledgerItem('保留的明细')], hasMore: true, nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [], hasMore: false }).mockRejectedValueOnce(busy())
  const { host } = await mountLedger()
  button(host, '加载更多').click()
  await settle()
  window.dispatchEvent(new Event(LEDGER_CHANGED_EVENT))
  await settle()
  expect(host.textContent).toContain('保留的明细')
  expect(host.textContent).not.toContain('没有匹配的明细')
  list.mockResolvedValueOnce({ items: [ledgerItem('恢复后的明细')], hasMore: false })
  button(host, '重试').click()
  await settle()
  expect(host.textContent).toContain('恢复后的明细')
  expect(host.querySelector('.status-notice')).toBeNull()
})

it('真实明细跨午夜恢复失败后原重试入口从首批重新读取', async () => {
  list.mockResolvedValueOnce({ items: [ledgerItem('午夜前的明细')], hasMore: true, nextCursor: 'expired' })
    .mockRejectedValueOnce(new LocalError('VALIDATION_FAILED', '分页位置无效', {
      fieldErrors: [{ field: 'cursor', message: '分页位置无效，请重新加载。' }],
    })).mockRejectedValueOnce(busy())
  const { host } = await mountLedger()
  button(host, '加载更多').click()
  await settle()
  expect(host.textContent).toContain('午夜前的明细')
  list.mockResolvedValueOnce({ items: [ledgerItem('午夜后的明细')], hasMore: false })
  button(host, '重试').click()
  await settle()
  expect(list.mock.calls.map(call => call[1])).toEqual([undefined, 'expired', undefined, undefined])
  expect(host.textContent).toContain('午夜后的明细')
  expect(host.textContent).not.toContain('午夜前的明细')
  expect(host.querySelector('.status-notice')).toBeNull()
})

it('清除已应用筛选时取消尚未到期的搜索，旧关键词不能复活', async () => {
  const { host, router, input } = await mountLedger()
  inputEvent(input, '待执行关键词')
  await settle()
  const clear = host.querySelector<HTMLButtonElement>('[aria-label="清除全部筛选"]')!
  expect(clear).toBeTruthy()
  clear.click()
  await settle()
  expect(router.currentRoute.value.query.q).toBeUndefined()
  await vi.advanceTimersByTimeAsync(1000)
  expect(router.currentRoute.value.query.q).toBeUndefined()
  expect(input.value).toBe('')
})
it('外部条件替换取消待执行搜索，不能覆盖新类型与关键词', async () => {
  const { router, input } = await mountLedger()
  inputEvent(input, '旧关键词')
  await settle()
  await router.replace('/ledger?type=INCOME&range=THIS_YEAR&q=新关键词')
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  expect(router.currentRoute.value.query).toMatchObject({ type: 'INCOME', q: '新关键词', range: 'THIS_YEAR' })
  expect(input.value).toBe('新关键词')
})
it('真实 KeepAlive 离页取消防抖，不污染其他页面；返回仍可正常搜索', async () => {
  const { host, router, input } = await mountLedger()
  inputEvent(input, '隐藏页关键词')
  await settle()
  await router.push('/me')
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  expect(router.currentRoute.value.fullPath).toBe('/me')
  await router.push('/ledger?type=ALL&range=THIS_MONTH')
  await settle()
  const restored = host.querySelector<HTMLInputElement>('#ledger-search')!
  expect(restored.value).toBe('')
  inputEvent(restored, '返回后查询')
  await settle()
  await vi.advanceTimersByTimeAsync(300)
  await settle()
  expect(router.currentRoute.value.query.q).toBe('返回后查询')
})

async function mountSearch(maxLength = 200) {
  const value = ref('')
  const context = ref('first')
  const active = ref(true)
  const search = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = defineComponent({ setup() {
    provide(pageActivityKey, active)
    return () => h(GlobalLedgerSearch, { id: 'unicode-search', modelValue: value.value, maxLength,
      contextKey: context.value, 'onUpdate:modelValue': (next: string) => { value.value = next }, onSearch: search })
  } })
  const app = createApp(root)
  cleanup = () => { app.unmount(); host.remove() }
  app.mount(host)
  await settle()
  return { input: host.querySelector<HTMLInputElement>('input')!, value, context, active, search }
}
function insert(input: HTMLInputElement, text: string) {
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })
  input.dispatchEvent(before)
  if (!before.defaultPrevented) {
    input.setRangeText(text, start, end, 'end')
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
  return before
}
function paste(input: HTMLInputElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
  input.dispatchEvent(event)
  if (!event.defaultPrevented) insert(input, text)
  return event
}
it.each(['长', '😀'])('可输入和粘贴 200 码点，第 201 个拒绝且保留已有内容：%s', async char => {
  const { input, value, search } = await mountSearch()
  expect(input.hasAttribute('maxlength')).toBe(false)
  for (let index = 0; index < 200; index++) insert(input, char)
  await settle()
  const full = char.repeat(200)
  expect(value.value).toBe(full)
  expect(insert(input, char).defaultPrevented).toBe(true)
  expect(input.value).toBe(full)
  await vi.advanceTimersByTimeAsync(300)
  expect(search.mock.calls).toEqual([[full]])
  inputEvent(input, '')
  await settle()
  expect(paste(input, full).defaultPrevented).toBe(false)
  await settle()
  expect(value.value).toBe(full)
  expect(paste(input, char).defaultPrevented).toBe(true)
  expect(input.value).toBe(full)
  // 满额时替换选中字符仍合法；UTF-16 光标不能被当成码点数量。
  input.setSelectionRange(0, char.length)
  expect(insert(input, '新').defaultPrevented).toBe(false)
  await settle()
  expect([...value.value]).toHaveLength(200)
})
it('共享搜索保留可配置 64 码点限制', async () => {
  const { input, value } = await mountSearch(64)
  expect(paste(input, '😀'.repeat(64)).defaultPrevented).toBe(false)
  await settle()
  expect(paste(input, '😀').defaultPrevented).toBe(true)
  expect([...value.value]).toHaveLength(64)
})

it('条件上下文同值替换取消防抖，普通 v-model 回显保留正常搜索', async () => {
  const { input, context, value, search } = await mountSearch()
  insert(input, '正常搜索')
  await settle()
  await vi.advanceTimersByTimeAsync(300)
  expect(search.mock.calls).toEqual([['正常搜索']])
  insert(input, '待取消')
  await settle()
  context.value = 'external-filter-replacement'
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  expect(search).toHaveBeenCalledTimes(1)
  // 与当前已输入值相同的外部上下文也必须取消，不能只比较 modelValue。
  expect(value.value).toBe('正常搜索待取消')
})
it('停用取消待执行和迟到输入，重新激活后 Enter 与清空各只提交一次', async () => {
  const { input, active, value, search } = await mountSearch()
  insert(input, '旧任务')
  await settle()
  active.value = false
  await settle()
  inputEvent(input, '隐藏页迟到输入')
  expect(value.value).toBe('旧任务')
  expect(input.value).toBe('旧任务')
  await vi.advanceTimersByTimeAsync(1000)
  expect(search).not.toHaveBeenCalled()
  active.value = true
  await settle()
  inputEvent(input, '新的输入')
  await settle()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(search.mock.calls).toEqual([['新的输入']])
  inputEvent(input, '')
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  expect(search.mock.calls).toEqual([['新的输入'], ['']])
})
it('中文输入法不提交预编辑；最终 200 码点接受，201 码点回退且不误发 Enter', async () => {
  const { input, value, search } = await mountSearch()
  const full = '😀'.repeat(199) + '中'
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  inputEvent(input, full)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(value.value).toBe('')
  expect(search).not.toHaveBeenCalled()
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }))
  await settle()
  await vi.advanceTimersByTimeAsync(300)
  expect(value.value).toBe(full)
  expect(search.mock.calls).toEqual([[full]])
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  inputEvent(input, full + '多')
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '多' }))
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  expect(input.value).toBe(full)
  expect(value.value).toBe(full)
  expect(search).toHaveBeenCalledTimes(1)
})
it('外部替换后的迟到输入法结束不能复活旧搜索，粘贴与非 beforeinput 输入仍受边界保护', async () => {
  const { input, value, search } = await mountSearch()
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  inputEvent(input, '未提交预编辑')
  value.value = '外部替换'
  await settle()
  input.value = '迟到预编辑'
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  expect(input.value).toBe('外部替换')
  expect(search).not.toHaveBeenCalled()
  input.setSelectionRange(0, input.value.length)
  expect(paste(input, '😀'.repeat(201)).defaultPrevented).toBe(true)
  expect(input.value).toBe('外部替换')
  inputEvent(input, '😀'.repeat(201))
  expect(input.value).toBe('外部替换')
  expect(value.value).toBe('外部替换')
})


it.each([
  { label: '取消预编辑', keyword: '苹果', preview: '苹果pin', final: '苹果' },
  { label: '拒绝第201码点', keyword: '😀'.repeat(200), preview: '😀'.repeat(200) + '多', final: '😀'.repeat(200) + '多' },
])('IME 防抖未到期时$label后仍提交合法关键词一次', async ({ keyword, preview, final }) => {
  const { input, router } = await mountLedger()
  inputEvent(input, keyword)
  await settle()
  await vi.advanceTimersByTimeAsync(100)
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  inputEvent(input, preview)
  await vi.advanceTimersByTimeAsync(1000)
  expect(router.currentRoute.value.query.q).toBeUndefined()
  input.value = final
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  // WebKit 可在 compositionend 后再发最终 input；不能重复提交。
  inputEvent(input, input.value)
  await settle()
  await vi.advanceTimersByTimeAsync(300)
  await settle()
  expect(input.value).toBe(keyword)
  expect(router.currentRoute.value.query.q).toBe(keyword)
  expect(list.mock.calls.filter(([filters]) => filters.query === keyword)).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(list.mock.calls.filter(([filters]) => filters.query === keyword)).toHaveLength(1)
})
it.each(['取消预编辑', '拒绝第201码点'])('IME 已提交值在%s后不重复查询', async kind => {
  const { input, search } = await mountSearch()
  const keyword = kind === '取消预编辑' ? '苹果' : '😀'.repeat(200)
  inputEvent(input, keyword)
  await settle()
  await vi.advanceTimersByTimeAsync(300)
  expect(search.mock.calls).toEqual([[keyword]])
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  inputEvent(input, keyword + '多')
  input.value = kind === '取消预编辑' ? keyword : keyword + '多'
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  inputEvent(input, input.value)
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  expect(input.value).toBe(keyword)
  expect(search.mock.calls).toEqual([[keyword]])
})
it('IME 连续取消仍只保留一份待提交，成功提交与后续输入取最新值', async () => {
  const { input, search } = await mountSearch()
  inputEvent(input, '旧')
  await settle()
  for (let round = 0; round < 2; round++) {
    await vi.advanceTimersByTimeAsync(100)
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    inputEvent(input, '旧pin')
    input.value = '旧'
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await settle()
  }
  await vi.advanceTimersByTimeAsync(100)
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  inputEvent(input, '新的合法值')
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  inputEvent(input, input.value)
  await settle()
  await vi.advanceTimersByTimeAsync(100)
  inputEvent(input, '最新输入')
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  expect(search.mock.calls).toEqual([['最新输入']])
})
it.each(['清除全部筛选', '清空搜索', '外部条件替换', '外部同值替换', '外部清除关键词', '离页'])
('IME 待续搜索在%s后失效，迟到结束不复活且后续正常搜索可用', async action => {
  const { host, router, input } = await mountLedger()
  const replace = vi.spyOn(router, 'replace')
  inputEvent(input, '旧关键词')
  await settle()
  await vi.advanceTimersByTimeAsync(100)
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  inputEvent(input, '旧关键词pin')
  if (action === '离页') await router.push('/me')
  else if (action.startsWith('外部')) await router.replace({ path: '/ledger', query: { type: 'INCOME', range: 'THIS_YEAR',
    ...(action === '外部条件替换' ? { q: '新关键词' } : action === '外部同值替换' ? { q: '旧关键词' } : {}) } })
  else {
    // DOM 点击不返回 router.replace 的 Promise，先等待该次导航（含重复导航）完成。
    const navigated = new Promise<void>(resolve => {
      const stop = router.afterEach(() => { stop(); resolve() })
    })
    host.querySelector<HTMLButtonElement>(`[aria-label="${action}"]`)!.click()
    await navigated
  }
  await settle()
  const expectedPath = router.currentRoute.value.fullPath
  const calls = replace.mock.calls.length
  input.value = '旧关键词'
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  inputEvent(input, input.value)
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  await settle()
  expect(router.currentRoute.value.fullPath).toBe(expectedPath)
  expect(replace).toHaveBeenCalledTimes(calls)
  if (action === '离页') {
    await router.push('/ledger?type=ALL&range=THIS_MONTH')
    await settle()
    expect(router.currentRoute.value.query.q).toBeUndefined()
  }
  const currentInput = host.querySelector<HTMLInputElement>('#ledger-search')!
  inputEvent(currentInput, '后续搜索')
  await settle()
  await vi.advanceTimersByTimeAsync(300)
  await settle()
  expect(router.currentRoute.value.query.q).toBe('后续搜索')
})

it('KeepAlive 无活动状态注入时，离页也撤销 IME 续发意图', async () => {
  const shown = ref(true)
  const value = ref('')
  const search = vi.fn()
  const away = { render: () => h('p', '其他页面') }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(KeepAlive, null, () => shown.value
    ? h(GlobalLedgerSearch, { id: 'cached-search', modelValue: value.value,
      'onUpdate:modelValue': (next: string) => { value.value = next }, onSearch: search })
    : h(away)) })
  cleanup = () => { app.unmount(); host.remove() }
  app.mount(host)
  await settle()
  const input = host.querySelector<HTMLInputElement>('input')!
  inputEvent(input, '旧关键词')
  await settle()
  await vi.advanceTimersByTimeAsync(100)
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  inputEvent(input, '旧关键词pin')
  shown.value = false
  await settle()
  input.value = '旧关键词'
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  await vi.advanceTimersByTimeAsync(1000)
  shown.value = true
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  expect(search).not.toHaveBeenCalled()
  inputEvent(input, '新关键词')
  await settle()
  await vi.advanceTimersByTimeAsync(300)
  expect(search.mock.calls).toEqual([['新关键词']])
})
