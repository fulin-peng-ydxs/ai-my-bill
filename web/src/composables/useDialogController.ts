import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** 统一原生 dialog 的开关、Esc 同步和关闭后焦点恢复。 */
export function useDialogController(open: Ref<boolean>, setOpen: (value: boolean) => void) {
  const dialog = ref<HTMLDialogElement>()
  let returnFocus: HTMLElement | null = null

  async function sync(): Promise<void> {
    await nextTick()
    const element = dialog.value
    if (!element) return
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
    if (open.value) setOpen(false)
    returnFocus?.focus()
    returnFocus = null
  }

  watch(open, sync)
  onMounted(sync)
  onBeforeUnmount(() => {
    if (dialog.value?.open) dialog.value.close()
  })
  return { dialog, handleCancel, handleClose }
}
