// @vitest-environment jsdom
import { createPinia,setActivePinia } from 'pinia'
import { afterEach,expect,it,vi } from 'vitest'
const state = vi.hoisted(() => ({ setTheme:vi.fn(async (_:{ theme:string }) => {}) }))
vi.mock('@capacitor/core',() => ({ registerPlugin:() => state }))
import { useThemeStore } from '../stores/theme'
afterEach(() => { vi.restoreAllMocks(); state.setTheme.mockClear() })
it('手选明暗通知原生状态栏，系统模式继续消费真实媒体偏好',() => {
  let dark = false, change = () => {}
  vi.stubGlobal('matchMedia',() => ({ get matches() { return dark },addEventListener:(_:string,callback:() => void) => { change = callback } }))
  setActivePinia(createPinia()); const theme = useThemeStore(); theme.initialize()
  theme.setMode('dark'); expect(state.setTheme).toHaveBeenLastCalledWith({ theme:'dark' })
  expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(false)
  theme.setMode('system'); expect(document.documentElement.dataset.theme).toBe('light')
  dark = true; change(); expect(document.documentElement.dataset.theme).toBe('dark')
  expect(state.setTheme).toHaveBeenLastCalledWith({ theme:'dark' })
  vi.unstubAllGlobals()
})
it('外观桥失败不回滚页面主题或阻断本地偏好',async () => {
  vi.stubGlobal('matchMedia',() => ({ matches:false,addEventListener:() => {} }))
  state.setTheme.mockRejectedValueOnce(new Error('unavailable'))
  setActivePinia(createPinia()); const theme = useThemeStore()
  theme.setMode('dark'); await Promise.resolve()
  expect(document.documentElement.dataset.theme).toBe('dark')
  vi.unstubAllGlobals()
})
