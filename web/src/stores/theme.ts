import { defineStore } from 'pinia'

import {
  isThemeMode,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeMode,
} from '../theme/theme'

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'
let mediaQuery: MediaQueryList | undefined

function storedMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system'
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeMode(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

function currentSystemPreference(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DARK_MEDIA_QUERY).matches
}

/** 主题的唯一运行时状态源；本地值只承载首屏与离线回退，服务端权威偏好由 T10 接入。 */
export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: 'system' as ThemeMode,
    resolved: 'light' as ResolvedTheme,
    initialized: false,
  }),
  actions: {
    initialize(): void {
      if (this.initialized) return
      this.mode = storedMode()
      this.apply()
      if (typeof window !== 'undefined') {
        mediaQuery = window.matchMedia(DARK_MEDIA_QUERY)
        mediaQuery.addEventListener('change', this.handleSystemThemeChange)
      }
      this.initialized = true
    },
    setMode(mode: ThemeMode): void {
      this.mode = mode
      try {
        localStorage.setItem(THEME_STORAGE_KEY, mode)
      } catch {
        // 存储被禁用时仍保留当前会话主题，不能阻断页面使用。
      }
      this.apply()
    },
    apply(): void {
      this.resolved = resolveTheme(this.mode, currentSystemPreference())
      if (typeof document === 'undefined') return
      document.documentElement.dataset.themeMode = this.mode
      document.documentElement.dataset.theme = this.resolved
      document.documentElement.style.colorScheme = this.resolved
      const themeColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-background')
        .trim()
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.setAttribute('content', themeColor)
    },
    handleSystemThemeChange(): void {
      if (this.mode === 'system') this.apply()
    },
  },
})
