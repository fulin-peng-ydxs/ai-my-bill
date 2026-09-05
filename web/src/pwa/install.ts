import { defineStore } from 'pinia'

export type InstallStatus = 'detecting' | 'available' | 'installing' | 'declined' | 'unsupported' | 'installed' | 'error'
export type InstallPlatform = 'ios' | 'android' | 'desktop'

let deferredPrompt: BeforeInstallPromptEvent | undefined
let listenersInstalled = false

export function detectInstallPlatform(userAgent: string): InstallPlatform {
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios'
  if (/android/i.test(userAgent)) return 'android'
  return 'desktop'
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

/** 安装能力唯一状态源；登录页与“我的”不得分别监听浏览器安装事件。 */
export const usePwaInstallStore = defineStore('pwa-install', {
  state: () => ({
    status: 'detecting' as InstallStatus,
    platform: 'desktop' as InstallPlatform,
  }),
  getters: {
    guidance: (state): string => {
      if (state.platform === 'ios') return '在 Safari 中点“分享”，再选择“添加到主屏幕”。'
      if (state.platform === 'android') return '打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。'
      return '可继续使用网页；如浏览器支持安装，请从地址栏或浏览器菜单安装。'
    },
  },
  actions: {
    initialize(): void {
      if (typeof window === 'undefined') return
      this.platform = detectInstallPlatform(window.navigator.userAgent)
      if (isStandaloneDisplay()) {
        this.status = 'installed'
      } else if (this.status === 'detecting') {
        window.setTimeout(() => {
          if (this.status === 'detecting') this.status = 'unsupported'
        }, 250)
      }
      if (listenersInstalled) return
      window.addEventListener('beforeinstallprompt', (event) => {
        this.capturePrompt(event as BeforeInstallPromptEvent)
      })
      window.addEventListener('appinstalled', () => {
        deferredPrompt = undefined
        this.status = 'installed'
      })
      listenersInstalled = true
    },
    capturePrompt(event: BeforeInstallPromptEvent): void {
      event.preventDefault()
      deferredPrompt = event
      this.status = 'available'
    },
    async install(): Promise<void> {
      const prompt = deferredPrompt
      if (!prompt || this.status !== 'available') return
      this.status = 'installing'
      try {
        await prompt.prompt()
        const choice = await prompt.userChoice
        deferredPrompt = undefined
        if (this.$state.status === 'installed') return
        this.status = choice.outcome === 'accepted' ? 'installing' : 'declined'
      } catch {
        deferredPrompt = undefined
        this.status = 'error'
      }
    },
    markInstalled(): void {
      deferredPrompt = undefined
      this.status = 'installed'
    },
  },
})
