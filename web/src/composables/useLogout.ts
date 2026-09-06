import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { hasUnsavedChangesNow, requestDiscardChanges } from './unsavedChanges'
import { usePreferencesStore } from '../stores/preferences'
import { useSessionStore } from '../stores/session'

/** 统一退出的防重复、错误恢复与导航状态，供用户设置和管理员页头复用。 */
export function useLogout() {
  const sessionStore = useSessionStore()
  const preferencesStore = usePreferencesStore()
  const router = useRouter()
  const loggingOut = ref(false)
  const logoutError = ref<string>()

  async function logout(): Promise<void> {
    if (loggingOut.value) return
    loggingOut.value = true
    if (hasUnsavedChangesNow() && !await requestDiscardChanges('logout')) {
      loggingOut.value = false
      return
    }
    logoutError.value = undefined
    try {
      await sessionStore.logout()
      preferencesStore.clearMemory()
      await router.replace('/login')
    } catch (error) {
      logoutError.value = error instanceof Error ? error.message : '退出未完成，请重试。'
    } finally {
      loggingOut.value = false
    }
  }

  return { loggingOut, logoutError, logout }
}
