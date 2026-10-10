import { onScopeDispose, watch } from 'vue'

interface ToastState {
  open: boolean
  message: string
  kind: 'success' | 'error'
  paused: boolean
  active: boolean
  notificationKey?: string
}

/** 成功反馈短暂展示；交互或撤销进行中暂停，隐藏页面的旧提示不在返回时重放。 */
export function useToastAutoDismiss(state: () => ToastState, dismiss: () => void) {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined
  function cancel(): void {
    if (timer !== undefined) globalThis.clearTimeout(timer)
    timer = undefined
  }
  watch(state, (current) => {
    cancel()
    if (!current.open) return
    if (!current.active) { dismiss(); return }
    if (current.kind !== 'success' || current.paused) return
    timer = globalThis.setTimeout(() => { timer = undefined; dismiss() }, 5000)
  }, { immediate: true })
  onScopeDispose(cancel)
}
