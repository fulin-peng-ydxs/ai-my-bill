import { afterEach, describe, expect, it, vi } from 'vitest'
import { markRaw, nextTick, ref } from 'vue'

const { hooks } = vi.hoisted(() => ({ hooks: {
  mounted: [] as Array<() => void>, activated: [] as Array<() => void>,
  deactivated: [] as Array<() => void>, unmounted: [] as Array<() => void>,
} }))
vi.mock('vue', async original => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => hooks.mounted.push(callback),
  onActivated: (callback: () => void) => hooks.activated.push(callback),
  onDeactivated: (callback: () => void) => hooks.deactivated.push(callback),
  onBeforeUnmount: (callback: () => void) => hooks.unmounted.push(callback),
}))
vi.mock('./useKeyboardViewport', () => ({ useKeyboardViewport: () => ({ keyboardOpen: ref(false) }) }))
import { receiptExtraSpace, useReceiptSpacing } from './useReceiptSpacing'

afterEach(() => {
  hooks.unmounted.forEach(callback => callback())
  Object.values(hooks).forEach(callbacks => { callbacks.length = 0 })
  vi.unstubAllGlobals()
})

describe('receipt spacing', () => {
  it('bounds growth and preserves natural heights on short screens and long forms', () => {
    expect(receiptExtraSpace(686, 527, 3, 760, 24)).toBe(24)
    expect(receiptExtraSpace(620, 527, 3, 760, 24)).toBe(15.5)
    expect(receiptExtraSpace(1200, 700, 3, 760, 24)).toBe(10)
    expect(receiptExtraSpace(450, 527, 3, 760, 24)).toBe(0)
    expect(receiptExtraSpace(1000, 900, 3, 760, 24)).toBe(0)
    expect(receiptExtraSpace(700, 527, 0, 760, 24)).toBe(0)
  })

  it('keeps collapsed-baseline spacing during disclosure changes and releases observers on leaving', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    let resize!: () => void
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      disconnect = disconnect
      observe = observe
    })
    function flush(): void {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(0))
    }
    class Details {
      expanded = false
      // 读取插值中的整体高度会重新分配上方留白，测试要求只读取固定摘要。
      getBoundingClientRect(): never { throw new Error('must not measure animated disclosure height') }
      querySelector() { return { getBoundingClientRect: () => ({ height: 44 }) } }
    }
    vi.stubGlobal('HTMLDetailsElement', Details)
    const details = new Details()
    const region = { clientHeight: 686, scrollTop: 0, classList: { contains: () => true }, getBoundingClientRect: () => ({ top: 0 }) }
    const element = { parentElement: region, nextElementSibling: null,
      closest: () => region, getBoundingClientRect: () => ({ top: 0 }), children: [] as unknown[] }
    vi.stubGlobal('getComputedStyle', (target: unknown) => ({
      borderTopWidth: target === element ? '1px' : '0px', borderBottomWidth: target === element ? '1px' : '0px',
      paddingTop: target === details ? '8px' : '0px', paddingBottom: target === details ? '8px' : '0px', rowGap: '0px',
      getPropertyValue: (name: string) => name === '--entry-receipt-max-height' ? '760px' : '24px',
    }))
    const extra = useReceiptSpacing(ref(markRaw(element) as unknown as HTMLElement))
    element.children = [122, 214, 129].map(height => ({ tagName: 'SECTION', getBoundingClientRect: () => ({ height: height + extra.value * 2 }) }))
    element.children.push(details)
    hooks.mounted.forEach(callback => callback())
    flush()
    expect(extra.value).toBe(24)
    details.expanded = true
    expect(frames.size).toBe(0)
    region.clientHeight = 620
    resize()
    flush()
    expect(extra.value).toBe(15.5)
    expect(observe).toHaveBeenCalledWith(region)
    resize()
    hooks.deactivated.forEach(callback => callback())
    expect(frames.size).toBe(0)
    expect(disconnect).toHaveBeenCalled()
    hooks.activated.forEach(callback => callback())
    hooks.deactivated.forEach(callback => callback())
    observe.mockClear()
    await nextTick()
    expect(observe).not.toHaveBeenCalled()
  })
})
