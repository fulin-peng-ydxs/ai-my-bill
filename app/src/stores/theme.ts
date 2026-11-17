import { defineStore } from 'pinia'
import { resolveTheme, type ThemeMode, type ResolvedTheme } from '../theme/theme'

/** 主题渲染消费统一 SQLite 偏好；自身不建立第二套持久化。 */
export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: 'system' as ThemeMode,
    resolved: 'light' as ResolvedTheme,
    initialized: false,
  }),
  actions: {
    initialize() {
      if (this.initialized) {
        return
      }
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      media.addEventListener('change', () => this.apply())
      this.initialized = true
      this.apply()
    },
    setMode(mode: ThemeMode) {
      this.mode = mode
      this.apply()
    },
    apply() {
      this.resolved = resolveTheme(this.mode, window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.themeMode = this.mode
      document.documentElement.dataset.theme = this.resolved
      document.documentElement.style.colorScheme = this.resolved
    },
  },
})
