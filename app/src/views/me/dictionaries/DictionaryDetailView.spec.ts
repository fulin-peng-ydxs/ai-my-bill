// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DictionaryPage } from '../../../api/dictionaries'
import DictionaryDetailView from './DictionaryDetailView.vue'
import { LocalError } from '../../../domain/localError'

const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../../api/dictionaries', async original => ({
  ...await original<typeof import('../../../api/dictionaries')>(), listDictionaryItems: list,
}))

function page(index: number, total: number, name = '保留项'): DictionaryPage {
  return { page: index, size: 20, total, items: index * 20 >= total ? [] : [
    { id: name, type: 'product', name, status: 'ACTIVE', sortOrder: 0, referenced: false },
  ] }
}
async function settle() { for (let i = 0; i < 15; i++) await nextTick() }
let cleanup = () => {}
afterEach(() => { cleanup(); vi.restoreAllMocks(); list.mockReset() })

async function mountLastPage() {
  list.mockImplementation(async (_type, _query, _status, _signal, index) => page(index, 21))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/me/dictionaries/:type', component: DictionaryDetailView },
  ] })
  await router.push('/me/dictionaries/product')
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp({ render: () => h(RouterView) }).use(router)
  cleanup = () => { app.unmount(); host.remove() }
  app.mount(host); await settle()
  const click = (label: string) => {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label || b.getAttribute('aria-label') === label)
    expect(button, label).toBeTruthy(); button!.click()
  }
  click('下一页'); await settle()
  expect(list.mock.lastCall?.[4]).toBe(1)
  list.mockClear()
  return { host, click }
}

describe('字典管理末页收敛', () => {
  it('总数减少后补读有效页，保留原列表和可继续操作的页码', async () => {
    const { host, click } = await mountLastPage()
    list.mockImplementation(async (_t, _q, _s, _signal, index) => page(index, 20))
    click('刷新商品'); await settle()
    expect(list.mock.calls.map(call => call[4])).toEqual([1, 0])
    expect(host.textContent).toContain('保留项')
    expect(host.textContent).not.toContain('还没有商品')
    list.mockClear(); click('刷新商品'); await settle()
    expect(list.mock.calls.map(call => call[4])).toEqual([0])
  })

  it('补读失败显示错误，原重试入口可重新收敛，不误报空字典', async () => {
    const { host, click } = await mountLastPage()
    list.mockImplementationOnce(async () => page(1, 20)).mockRejectedValueOnce(new LocalError('DATABASE_BUSY', '受控读取失败', { retryable: true }))
    click('刷新商品'); await settle()
    expect(host.textContent).toContain('商品暂不可用')
    expect(host.textContent).not.toContain('还没有商品')
    list.mockImplementation(async (_t, _q, _s, _signal, index) => page(index, 20))
    click('重试'); await settle()
    expect(host.textContent).toContain('保留项')
    expect(host.textContent).not.toContain('商品暂不可用')
  })

  it('补读晚于新搜索完成时，不能覆盖新结果或改变其页码', async () => {
    const { host, click } = await mountLastPage()
    let resolveOld!: (value: DictionaryPage) => void
    list.mockImplementationOnce(async () => page(1, 20)).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    click('刷新商品'); await settle()
    const input = host.querySelector<HTMLInputElement>('input[type=search]')!
    input.value = '新搜索'; input.dispatchEvent(new Event('input', { bubbles: true }))
    list.mockImplementation(async (_t, _q, _s, _signal, index) => page(index, 21, '新结果'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle()
    click('下一页'); await settle()
    expect(list.mock.lastCall?.[4]).toBe(1)
    resolveOld(page(0, 20, '旧结果')); await settle()
    expect(host.textContent).toContain('新结果')
    expect(host.textContent).not.toContain('旧结果')
    list.mockClear(); click('刷新商品'); await settle()
    expect(list.mock.lastCall?.[1]).toBe('新搜索')
    expect(list.mock.lastCall?.[4]).toBe(1)
  })
})
