import { afterEach, describe, expect, it, vi } from 'vitest'
import { pageScrollTop, scrollPageTo, revealFocusedPageControl, restorePageScrollBounds } from './pageScroll'

afterEach(() => { vi.unstubAllGlobals() })

describe('active page scroll restoration', () => {
  it('clamps keyboard-induced overflow while retaining valid content scroll positions', () => {
    const region = { clientHeight: 600, scrollHeight: 900, scrollTop: 510, scrollTo: vi.fn() }
    const workspace = { querySelector: () => region } as unknown as globalThis.HTMLElement
    restorePageScrollBounds(workspace)
    expect(region.scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'instant' })
    region.scrollTop = 200
    restorePageScrollBounds(workspace)
    region.clientHeight = 0
    restorePageScrollBounds(workspace)
    restorePageScrollBounds(undefined)
    expect(region.scrollTo).toHaveBeenCalledTimes(1)
  })
  it('reads and restores the content below a fixed filter header', () => {
    const content = { scrollTop: 260, scrollTo: vi.fn() }
    const page = { scrollTop: 0, querySelector: () => content }
    vi.stubGlobal('document', { querySelector: () => page })
    vi.stubGlobal('scrollY', 0)
    expect(pageScrollTop()).toBe(260)
    scrollPageTo(260)
    expect(content.scrollTo).toHaveBeenCalledWith({ top: 260 })
  })
  it('reveals focused fields inside their own region without panning the window or inactive pages', () => {
    let bounds = { top: 400, bottom: 488 }
    const field = { matches: () => true, getBoundingClientRect: () => bounds }
    const scrollBy = vi.fn()
    const region = { contains: (value: unknown) => value === field, getBoundingClientRect: () => ({ top: 100, bottom: 360, height: 260 }), scrollBy }
    const workspace = { querySelector: () => region } as unknown as globalThis.HTMLElement
    vi.stubGlobal('document', { activeElement: field })
    revealFocusedPageControl(workspace)
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 128, behavior: 'instant' })
    bounds = { top: 50, bottom: 138 }
    revealFocusedPageControl(workspace)
    expect(scrollBy).toHaveBeenLastCalledWith({ top: -50, behavior: 'instant' })
    bounds = { top: 150, bottom: 238 }
    revealFocusedPageControl(workspace)
    revealFocusedPageControl(undefined)
    vi.stubGlobal('document', { activeElement: {} })
    revealFocusedPageControl(workspace)
    expect(scrollBy).toHaveBeenCalledTimes(2)
    vi.stubGlobal('document', { activeElement: field })
    bounds = { top: 140, bottom: 500 }
    revealFocusedPageControl(workspace)
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 40, behavior: 'instant' })
    bounds = { top: 100, bottom: 460 }
    revealFocusedPageControl(workspace)
    expect(scrollBy).toHaveBeenCalledTimes(3)
  })
  it('keeps whole-content settings pages and shell-free pages restorable', () => {
    const page = { scrollTop: 100, querySelector: () => null, scrollTo: vi.fn() }
    vi.stubGlobal('document', { querySelector: () => page })
    expect(pageScrollTop()).toBe(100)
    scrollPageTo(100)
    expect(page.scrollTo).toHaveBeenCalledWith({ top: 100 })
    vi.stubGlobal('document', { querySelector: () => null })
    vi.stubGlobal('scrollY', 80)
    const windowScroll = vi.fn()
    vi.stubGlobal('scrollTo', windowScroll)
    expect(pageScrollTop()).toBe(80)
    scrollPageTo(80)
    expect(windowScroll).toHaveBeenCalledWith({ top: 80 })
  })
})
