import { afterEach, describe, expect, it, vi } from 'vitest'

const { cleanups } = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }))
vi.mock('vue', async (original) => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => callback(),
  onBeforeUnmount: (callback: () => void) => cleanups.push(callback),
}))
import { useKeyboardViewport } from './useKeyboardViewport'

function environment() {
  class Input { type = 'text'; readOnly = false }
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
  const frames: Array<() => void> = []
  const window = Object.assign(new EventTarget(), {
    innerHeight: 844, visualViewport: viewport,
    requestAnimationFrame: vi.fn((callback: () => void) => { frames.push(callback); return frames.length }),
    cancelAnimationFrame: vi.fn(),
  })
  const document = Object.assign(new EventTarget(), { activeElement: new Input() as object | null })
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
  vi.unstubAllGlobals()
})

describe('shared keyboard viewport', () => {
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

  it('observes keyboard dismissal even if iOS keeps the search input focused', () => {
    const env = environment()
    const { keyboardOpen } = useKeyboardViewport()
    env.resize(500)
    expect(keyboardOpen.value).toBe(true)
    env.resize(400, 2)
    expect(keyboardOpen.value).toBe(true)
    env.resize(844)
    expect(keyboardOpen.value).toBe(false)
    expect(env.document.activeElement).not.toBeNull()
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
