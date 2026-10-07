import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 仅在编辑控件聚焦且可见视口实际收缩时让出键盘空间；页面缩放不当作键盘。 */
export function useKeyboardViewport() {
  const keyboardOpen = ref(false)
  let viewport: globalThis.VisualViewport | null = null
  let frame: number | undefined
  function update(): void {
    const active = globalThis.document.activeElement
    const editing = active instanceof globalThis.HTMLTextAreaElement
      || (active instanceof globalThis.HTMLInputElement && !active.readOnly
        && !['button', 'checkbox', 'radio', 'submit', 'range'].includes(active.type))
    keyboardOpen.value = Boolean(viewport && viewport.scale === 1 && (editing || keyboardOpen.value)
      && globalThis.window.innerHeight - viewport.height > 150)
  }
  function schedule(): void {
    if (frame !== undefined) return
    frame = globalThis.window.requestAnimationFrame(() => { frame = undefined; update() })
  }
  onMounted(() => {
    viewport = globalThis.window.visualViewport
    viewport?.addEventListener('resize', schedule)
    globalThis.window.addEventListener('resize', schedule)
    globalThis.document.addEventListener('focusin', schedule)
    globalThis.document.addEventListener('focusout', schedule)
    update()
  })
  onBeforeUnmount(() => {
    if (frame !== undefined) globalThis.window.cancelAnimationFrame(frame)
    viewport?.removeEventListener('resize', schedule)
    globalThis.window.removeEventListener('resize', schedule)
    globalThis.document.removeEventListener('focusin', schedule)
    globalThis.document.removeEventListener('focusout', schedule)
  })
  return { keyboardOpen }
}
