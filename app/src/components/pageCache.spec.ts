// @vitest-environment jsdom
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import CachedPageView from './CachedPageView.vue'
import { usePageActivity } from '../composables/usePageActivity'
import { useDelayedLoading } from '../composables/useDelayedLoading'

describe('真实缓存页路由生命周期', () => {
  it('隐藏页停用加载计时器并保留自己的路由、输入；返回重启等待而非重建', async () => {
    const states = new Map<string, { active: ReturnType<typeof usePageActivity>; route: ReturnType<typeof useRoute>; draft: ReturnType<typeof ref<string>>; visible: ReturnType<typeof useDelayedLoading> }>()
    const page = (name: string) => defineComponent({ setup() {
      const draft = ref('')
      const state = { active: usePageActivity(), route: useRoute(), draft, visible: useDelayedLoading(true) }
      states.set(name, state)
      return () => h('div', { 'data-page-scroll': '' }, draft.value)
    } })
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/one', name: 'one', component: page('one') },
      { path: '/two', name: 'two', component: page('two') },
    ] })
    const host = document.createElement('div')
    host.className = 'shell-content'
    document.body.append(host)
    const oldScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    vi.useFakeTimers()
    const app = createApp({ render: () => h(RouterView, null, { default: ({ Component, route }: { Component: unknown; route: ReturnType<typeof useRoute> }) =>
      h(KeepAlive, { max: 2 }, () => Component ? h(CachedPageView, { key: String(route.name), component: Component as never, route }) : undefined),
    }) }).use(router)
    try {
      await router.push('/one')
      app.mount(host)
      await nextTick()
      const first = states.get('one')!
      first.draft.value = '保留输入'
      await vi.advanceTimersByTimeAsync(500)
      expect(first.visible.value).toBe(true)
      await router.push('/two')
      await nextTick()
      expect(first.active.value).toBe(false)
      expect(first.visible.value).toBe(false)
      expect(first.route.path).toBe('/one')
      await vi.advanceTimersByTimeAsync(1000)
      expect(first.visible.value).toBe(false)
      await router.push('/one')
      await nextTick()
      expect(states.get('one')).toBe(first)
      expect(first.draft.value).toBe('保留输入')
      expect(first.active.value).toBe(true)
      expect(first.visible.value).toBe(false)
      await vi.advanceTimersByTimeAsync(500)
      expect(first.visible.value).toBe(true)
    } finally {
      app.unmount()
      host.remove()
      vi.useRealTimers()
      if (oldScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', oldScrollTo)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo
    }
  })
})
