import { afterEach, describe, expect, it, vi } from 'vitest'

const { cleanups } = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }))
vi.mock('vue', async (original) => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => callback(),
  onBeforeUnmount: (callback: () => void) => cleanups.push(callback),
}))
import { useKeyboardViewport } from './useKeyboardViewport'

function environment() {
  class Input { type = 'text'; readOnly = false; blur = vi.fn() }
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
  const frames: Array<() => void> = []
  const window = Object.assign(new EventTarget(), {
    innerHeight: 844, visualViewport: viewport,
    requestAnimationFrame: vi.fn((callback: () => void) => { frames.push(callback); return frames.length }),
    cancelAnimationFrame: vi.fn(),
    scrollY: 0, scrollTo: vi.fn(),
  })
  const document = Object.assign(new EventTarget(), { documentElement: { clientHeight: 844 }, activeElement: new Input() as object | null,
    querySelector: vi.fn(() => ({ contains: (): boolean => true, isConnected: true, querySelector: (): globalThis.HTMLElement | null => null })),
  })
  vi.stubGlobal('HTMLInputElement', Input)
  vi.stubGlobal('HTMLTextAreaElement', class {})
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  return { viewport, document, window, resize(height: number, scale = 1) {
    viewport.height = height; viewport.scale = scale
    viewport.dispatchEvent(new Event('resize'))
    frames.splice(0).forEach((callback) => callback())
  } }
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('shared keyboard viewport', () => {
  it('does not blur fields outside the normal user shell', () => {
    const env = environment()
    env.document.querySelector.mockReturnValue({ contains: () => false, isConnected: true, querySelector: () => null })
    const field = env.document.activeElement as { blur: ReturnType<typeof vi.fn> }
    useKeyboardViewport()
    env.resize(500)
    env.resize(844)
    expect(field.blur).not.toHaveBeenCalled()
  })
  it('repairs a late iOS scroll offset after dismissal and cancels recovery if the keyboard reopens', () => {
    vi.useFakeTimers()
    const env = environment()
    const region = { clientHeight: 600, scrollHeight: 900, scrollTop: 200, scrollTo: vi.fn() }
    env.document.querySelector.mockReturnValue({ contains: () => true, isConnected: true,
      querySelector: () => region as unknown as globalThis.HTMLElement })
    useKeyboardViewport()
    env.resize(500)
    env.resize(844)
    region.scrollTop = 550
    vi.advanceTimersByTime(350)
    expect(region.scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'instant' })
    region.scrollTo.mockClear()
    env.resize(500)
    env.resize(844)
    env.resize(500)
    vi.advanceTimersByTime(350)
    expect(region.scrollTo).not.toHaveBeenCalled()
  })
  it('clears only the app shell outer pan after keyboard dismissal', () => {
    const env = environment()
    useKeyboardViewport()
    env.resize(500)
    env.window.scrollY = 240
    const field = env.document.activeElement as { blur: ReturnType<typeof vi.fn> }
    env.resize(400, 2)
    expect(field.blur).not.toHaveBeenCalled()
    expect(env.window.scrollTo).not.toHaveBeenCalled()
    env.resize(844)
    expect(env.window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' })
    expect(field.blur).toHaveBeenCalledOnce()
  })
  it('reserves the actual input-toolbar space without confusing it with a full keyboard or zoom', () => {
    const env = environment()
    const state = useKeyboardViewport()
    env.resize(790)
    expect(state.keyboardOpen.value).toBe(false)
    expect(state.visibleHeight.value).toBe(790)
    expect(state.bottomInset.value).toBe(54)
    env.viewport.offsetTop = 20
    env.resize(500)
    expect(state.topInset.value).toBe(20)
    expect(state.bottomInset.value).toBe(324)
    env.resize(300, 2)
    expect(state.topInset.value).toBe(20)
    expect(state.visibleHeight.value).toBe(500)
    expect(state.bottomInset.value).toBe(324)
  })

  it('keeps the keyboard state when iOS pans to a lower field and shrinks innerHeight', () => {
    const env = environment()
    const state = useKeyboardViewport()
    env.window.innerHeight = 380
    env.document.documentElement.clientHeight = 699
    env.viewport.offsetTop = 318
    env.resize(369)
    expect(state.keyboardOpen.value).toBe(true)
    expect(state.visibleHeight.value).toBe(369)
    expect(state.topInset.value).toBe(318)
    expect(state.bottomInset.value).toBe(12)
    env.window.innerHeight = 699
    env.viewport.offsetTop = 0
    env.resize(699)
    expect(state.keyboardOpen.value).toBe(false)
    expect(state.topInset.value).toBe(0)
  })

  it('ends only the editing focus left by a confirmed keyboard dismissal', () => {
    const env = environment()
    const { keyboardOpen } = useKeyboardViewport()
    env.resize(500)
    expect(keyboardOpen.value).toBe(true)
    env.resize(400, 2)
    expect(keyboardOpen.value).toBe(true)
    env.resize(844)
    expect(keyboardOpen.value).toBe(false)
    expect((env.document.activeElement as { blur: ReturnType<typeof vi.fn> }).blur).toHaveBeenCalledOnce()
  })

  it('ignores browser chrome, non-editing shrinkage and pinch zoom', () => {
    const env = environment()
    const { keyboardOpen } = useKeyboardViewport()
    env.resize(750)
    expect(keyboardOpen.value).toBe(false)
    env.resize(400, 2)
    expect(keyboardOpen.value).toBe(false)
    env.document.activeElement = null
    env.resize(500)
    expect(keyboardOpen.value).toBe(false)
  })

  it('shares one listener and releases it only after the last consumer unmounts', () => {
    const env = environment()
    const subscribe = vi.spyOn(env.viewport, 'addEventListener')
    const unsubscribe = vi.spyOn(env.viewport, 'removeEventListener')
    const shell = useKeyboardViewport()
    const field = useKeyboardViewport()
    expect(shell.keyboardOpen).toBe(field.keyboardOpen)
    expect(subscribe).toHaveBeenCalledTimes(2)
    cleanups.shift()!()
    expect(unsubscribe).not.toHaveBeenCalled()
    env.resize(500)
    expect(field.keyboardOpen.value).toBe(true)
    cleanups.shift()!()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
    expect(field.keyboardOpen.value).toBe(false)
  })
})
