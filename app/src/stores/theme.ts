import { defineStore } from 'pinia'
import { resolveTheme, type ThemeMode, type ResolvedTheme } from '../theme/theme'

/** T4 仅维护运行期主题；T7 接统一 SQLite 偏好，不使用第二套浏览器持久化。 */
export const useThemeStore = defineStore('theme', {
  state: () => ({ mode: 'system' as ThemeMode, resolved: 'light' as ResolvedTheme, initialized: false }),
  actions: {
    initialize() {
      if (this.initialized) return
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      media.addEventListener('change', () => this.apply())
      this.initialized = true
      this.apply()
    },
    setMode(mode: ThemeMode) { this.mode = mode; this.apply() },
    apply() {
      this.resolved = resolveTheme(this.mode, window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.themeMode = this.mode
      document.documentElement.dataset.theme = this.resolved
      document.documentElement.style.colorScheme = this.resolved
    },
  },
})
