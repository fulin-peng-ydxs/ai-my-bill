// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { expect, it, vi } from 'vitest'
import AnchoredDropdown from './AnchoredDropdown.vue'

it.each([[0, 0], [150, 150], [200, 150]])('键盘平移与文档滚动只换算一次：offset=%i scroll=%i', async (offset, scroll) => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.stubGlobal('scrollY', scroll)
  vi.stubGlobal('scrollX', scroll)
  vi.stubGlobal('visualViewport', { offsetTop: offset, offsetLeft: offset, height: 142, width: 932,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('anchored-dropdown') ? 44 : 600
  })
  const host = document.createElement('div'), input = document.createElement('input'), mount = document.createElement('div')
  host.setAttribute('data-page-scroll', '')
  host.append(input, mount); document.body.append(host)
  const top = Math.max(0, offset - scroll)
  const rect = (start: number, end: number) => ({ top: start, bottom: end, left: 10, right: 400, width: 390, height: end - start, x: 10, y: start, toJSON: () => ({}) })
  host.getBoundingClientRect = () => rect(top + 15, top + 117)
  input.getBoundingClientRect = () => rect(top + 66, top + 117)
  input.focus()
  const close = vi.fn()
  const app = createApp({ render: () => h(AnchoredDropdown, { id: 'candidate', open: true, anchor: input, onClose: close }, () => h('button', '工资')) })
  try {
    app.mount(mount)
    await nextTick(); await vi.advanceTimersByTimeAsync(100)
    expect(close).not.toHaveBeenCalled()
    const panel = host.querySelector<HTMLElement>('.anchored-dropdown')!
    expect(panel.style.visibility).toBe('visible')
    expect(panel.style.maxHeight).toBe('47px')
    expect(panel.style.top).toBe(`${top + 16}px`)
    expect(panel.style.left).toBe(`${Math.max(10,top)+8}px`)
    // 真实滚离字段仍关闭，坐标修复不把候选钉在页面上。
    input.blur(); input.getBoundingClientRect = () => rect(-100, -49)
    window.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(100)
    expect(close).toHaveBeenCalledWith(false)
  } finally {
    app.unmount(); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
  }
})
