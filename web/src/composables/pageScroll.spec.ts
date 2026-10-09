import { afterEach, describe, expect, it, vi } from 'vitest'
import { pageScrollTop, scrollPageTo } from './pageScroll'

afterEach(() => { vi.unstubAllGlobals() })

describe('active page scroll restoration', () => {
  it('reads and restores the content below a fixed filter header', () => {
    const content = { scrollTop: 260, scrollTo: vi.fn() }
    const page = { scrollTop: 0, querySelector: () => content }
    vi.stubGlobal('document', { querySelector: () => page })
    vi.stubGlobal('scrollY', 0)
    expect(pageScrollTop()).toBe(260)
    scrollPageTo(260)
    expect(content.scrollTo).toHaveBeenCalledWith({ top: 260 })
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
