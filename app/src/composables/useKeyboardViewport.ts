import { onBeforeUnmount, onMounted, ref } from 'vue'
import { restorePageScrollBounds } from './pageScroll'

const keyboardOpen = ref(false)
const visibleHeight = ref(0)
const bottomInset = ref(0)
const topInset = ref(0)
let consumers = 0
let viewport: globalThis.VisualViewport | null = null
let frame: number | undefined
let recovery: ReturnType<typeof globalThis.setTimeout> | undefined

function cancelRecovery(): void {
  if (recovery !== undefined) globalThis.clearTimeout(recovery)
  recovery = undefined
}

function update(): void {
  // 捏合缩放不是键盘收起，不在缩放过程中改变已经确认的输入状态。
  if (viewport && viewport.scale !== 1) return
  // iOS 聚焦靠下字段时 innerHeight 可能随平移缩小；clientHeight 仍是布局视口。
  // 使用布局高度识别遮挡，避免完整键盘被误判成仅有输入工具栏。
  const layoutHeight = Math.max(globalThis.window.innerHeight, globalThis.document.documentElement?.clientHeight ?? 0)
  visibleHeight.value = Math.min(viewport?.height ?? layoutHeight, layoutHeight)
  topInset.value = viewport?.offsetTop ?? 0
  // 镜像输入工具栏也会占用可见区域，即使未达到完整键盘的识别阈值，抽屉仍需避让。
  bottomInset.value = Math.max(0, layoutHeight - visibleHeight.value - (viewport?.offsetTop ?? 0))
  const active = globalThis.document.activeElement
  const editing = active instanceof globalThis.HTMLTextAreaElement
    || (active instanceof globalThis.HTMLInputElement && !active.readOnly
      && !['button', 'checkbox', 'radio', 'submit', 'range'].includes(active.type))
  const wasOpen = keyboardOpen.value
  keyboardOpen.value = Boolean(viewport && viewport.scale === 1 && (editing || wasOpen)
    && layoutHeight - viewport.height > 150)
  if (keyboardOpen.value) cancelRecovery()
  if (wasOpen && !keyboardOpen.value) {
    const shell = globalThis.document.querySelector<globalThis.HTMLElement>('.app-shell')
    if (shell) {
      // Safari 的完成动作可能仍保留输入焦点与内部平移；结束本次输入才能真正恢复页面。
      if (editing && active && shell.contains(active)) {
        (active as globalThis.HTMLInputElement | globalThis.HTMLTextAreaElement).blur()
      }
      if (globalThis.window.scrollY) globalThis.window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
      cancelRecovery()
      // iOS 结束原生平移动画晚于最后一次 viewport resize；在动画后再纠正一次越界。
      // 只有一个有界任务，重开键盘/卸载取消，正常滚动位置不受影响。
      recovery = globalThis.setTimeout(() => {
        recovery = undefined
        if (keyboardOpen.value || viewport?.scale !== 1 || !shell.isConnected) return
        if (globalThis.window.scrollY) globalThis.window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
        restorePageScrollBounds(shell)
      }, 350)
    }
  }
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
    viewport?.addEventListener('scroll', schedule)
    globalThis.window.addEventListener('resize', schedule)
    globalThis.document.addEventListener('focusin', schedule)
    globalThis.document.addEventListener('focusout', schedule)
    update()
  })
  onBeforeUnmount(() => {
    if (--consumers > 0) return
    cancelRecovery()
    if (frame !== undefined) globalThis.window.cancelAnimationFrame(frame)
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    globalThis.window.removeEventListener('resize', schedule)
    globalThis.document.removeEventListener('focusin', schedule)
    globalThis.document.removeEventListener('focusout', schedule)
    frame = undefined
    viewport = null
    keyboardOpen.value = false
    visibleHeight.value = 0
    bottomInset.value = 0
    topInset.value = 0
  })
  return { keyboardOpen, visibleHeight, bottomInset, topInset }
}
