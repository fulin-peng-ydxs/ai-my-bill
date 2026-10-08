import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch, type Ref } from 'vue'

/** 统一原生 dialog 的开关、Esc 同步和关闭后焦点恢复。 */
export function useDialogController(open: Ref<boolean>, setOpen: (value: boolean) => void) {
  const dialog = ref<HTMLDialogElement>()
  let active = true
  let suspendedCloses = 0
  let returnFocus: HTMLElement | null = null

  async function sync(): Promise<void> {
    await nextTick()
    const element = dialog.value
    if (!active || !element) return
    if (open.value && !element.open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      element.showModal()
    } else if (!open.value && element.open) {
      element.close()
    }
  }

  function handleCancel(event: Event): void {
    event.preventDefault()
    setOpen(false)
  }

  function handleClose(): void {
    if (suspendedCloses > 0) { suspendedCloses -= 1; return }
    if (!active) return
    if (open.value) setOpen(false)
    if (returnFocus?.isConnected) returnFocus.focus()
    returnFocus = null
  }

  watch(open, sync)
  onMounted(sync)
  function suspend(): void {
    active = false
    returnFocus = null
    if (dialog.value?.open) { suspendedCloses += 1; dialog.value.close() }
  }
  onActivated(() => { active = true; void sync() })
  onDeactivated(suspend)
  onBeforeUnmount(suspend)
  return { dialog, handleCancel, handleClose }
}
