import { onBeforeUnmount, onMounted, ref } from 'vue'

const keyboardOpen = ref(false)
let consumers = 0
let viewport: globalThis.VisualViewport | null = null
let frame: number | undefined

function update(): void {
  // 捏合缩放不是键盘收起，不在缩放过程中改变已经确认的输入状态。
  if (viewport && viewport.scale !== 1) return
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

/** 仅在编辑控件聚焦且可见视口实际收缩时让出键盘空间；页面缩放不当作键盘。 */
export function useKeyboardViewport() {
  onMounted(() => {
    if (consumers++ > 0) return
    viewport = globalThis.window.visualViewport
    viewport?.addEventListener('resize', schedule)
    globalThis.window.addEventListener('resize', schedule)
    globalThis.document.addEventListener('focusin', schedule)
    globalThis.document.addEventListener('focusout', schedule)
    update()
  })
  onBeforeUnmount(() => {
    if (--consumers > 0) return
    if (frame !== undefined) globalThis.window.cancelAnimationFrame(frame)
    viewport?.removeEventListener('resize', schedule)
    globalThis.window.removeEventListener('resize', schedule)
    globalThis.document.removeEventListener('focusin', schedule)
    globalThis.document.removeEventListener('focusout', schedule)
    frame = undefined
    viewport = null
    keyboardOpen.value = false
  })
  return { keyboardOpen }
}
