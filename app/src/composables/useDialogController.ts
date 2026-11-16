import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import { afterMotion } from './motion'
import { useMotionPreference } from './useMotionPreference'

const modalStack: HTMLDialogElement[] = []
/** 反馈进入当前原生顶层，避免成功/失败消息被 dialog 遮罩挡住。 */
export const dialogMessageTarget = shallowRef<HTMLDialogElement>()
let openingSequence = 0
const pendingSync = new Map<object, { order: number; run: () => void }>()
let syncScheduled = false

function scheduleSync(key: object, order: number, run: () => void): void {
  pendingSync.set(key, { order, run })
  if (syncScheduled) return
  syncScheduled = true
  void nextTick(() => {
    const updates = [...pendingSync.values()].sort((a, b) => a.order - b.order)
    pendingSync.clear()
    syncScheduled = false
    updates.forEach(update => update.run())
  })
}

/** 统一原生弹层、遮罩关闭及嵌套弹层返回焦点；父层保留在 top layer 中。 */
export function useDialogController(open: Ref<boolean>, setOpen: (value: boolean) => void) {
  const dialog = ref<HTMLDialogElement>()
  const phase = ref<'closed' | 'opening' | 'open' | 'closing'>('closed')
  const reducedMotion = useMotionPreference()
  let cancelMotion: (() => void) | undefined
  const syncKey = {}
  let openingOrder = open.value ? ++openingSequence : 0
  let active = true
  let suspendedCloses = 0
  let returnFocus: HTMLElement | null = null
  let backdropPress: { id: number; x: number; y: number; released: boolean } | undefined

  function setPhase(value: typeof phase.value): void {
    phase.value = value
    if (dialog.value?.dataset) dialog.value.dataset.motionPhase = value
    if (value === 'closed' || value === 'open') {
      for (const property of ['--motion-panel-start', '--motion-opacity-start', '--motion-backdrop-start']) dialog.value?.style?.removeProperty(property)
    }
  }
  function stopMotion(): void { cancelMotion?.(); cancelMotion = undefined }
  function finishClose(): void {
    stopMotion()
    setPhase('closed')
    removeFromStack()
    dialog.value?.close()
  }
  function animate(value: 'opening' | 'closing'): void {
    stopMotion()
    const element = dialog.value
    const panel = element?.querySelector?.<HTMLElement>('.overlay-panel')
    // 反向操作从当前视觉位置续接；定位仍由 dialog 本身负责。
    if (panel && element && typeof globalThis.getComputedStyle === 'function' && (phase.value === 'opening' || phase.value === 'closing')) {
      const style = getComputedStyle(panel)
      element.style.setProperty('--motion-panel-start', style.transform)
      element.style.setProperty('--motion-opacity-start', style.opacity)
      element.style.setProperty('--motion-backdrop-start', getComputedStyle(element, '::backdrop').opacity)
    }
    setPhase(value)
    const finish = () => {
      if (!active || phase.value !== value) return
      if (value === 'closing' && !open.value) finishClose()
      else if (value === 'opening' && open.value) setPhase('open')
    }
    if (reducedMotion.value || globalThis.document?.hidden) finish()
    else cancelMotion = afterMotion(panel, finish)
  }

  function removeFromStack(): void {
    const index = modalStack.indexOf(dialog.value!)
    if (index >= 0) modalStack.splice(index, 1)
    dialogMessageTarget.value = modalStack.at(-1)
    backdropPress = undefined
  }

  function isBackdrop(event: MouseEvent): boolean {
    const element = dialog.value
    if (!element?.open || phase.value === 'closing' || event.target !== element || modalStack.at(-1) !== element) return false
    const rect = element.getBoundingClientRect()
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
  }

  function handlePointerDown(event: PointerEvent): void {
    backdropPress = event.isPrimary && event.button === 0 && isBackdrop(event)
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, released: false } : undefined
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!backdropPress || backdropPress.id !== event.pointerId || !isBackdrop(event)
      || Math.hypot(event.clientX - backdropPress.x, event.clientY - backdropPress.y) > 8) {
      backdropPress = undefined
      return
    }
    backdropPress.released = true
  }

  function handleBackdropClick(event: MouseEvent): void {
    const dismiss = backdropPress?.released && isBackdrop(event)
    backdropPress = undefined
    if (!dismiss) return
    // 在 click 阶段关闭，避免 pointerup 后重新命中刚恢复的父层。
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
  }

  function handlePointerCancel(): void { backdropPress = undefined }

  function sync(): void {
    // 缓存页面返回时按最初打开顺序恢复父/子层，避免模板位置颠倒 top layer。
    scheduleSync(syncKey, openingOrder, () => {
      const element = dialog.value
      if (!active || !element) return
      if (open.value && !element.open) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        element.showModal()
        modalStack.push(element)
        dialogMessageTarget.value = element
        animate('opening')
      } else if (open.value && phase.value === 'closing') {
        // 同一实例重新打开不重复入栈，也不让上一次动画恢复旧焦点。
        animate('opening')
      } else if (!open.value && element.open) {
        if (phase.value !== 'closing') animate('closing')
      }
    })
  }

  function handleCancel(event: Event): void {
    event.preventDefault()
    setOpen(false)
  }

  function handleClose(): void {
    if (suspendedCloses > 0) { suspendedCloses -= 1; return }
    // close 异步投递；快速重新打开后，旧事件不能关闭新弹层。
    if (!active || dialog.value?.open) return
    stopMotion()
    setPhase('closed')
    removeFromStack()
    if (open.value) setOpen(false)
    const parent = modalStack.at(-1)
    if (returnFocus?.isConnected && (!parent || parent.contains(returnFocus))) returnFocus.focus({ preventScroll: true })
    returnFocus = null
  }

  watch(open, value => {
    if (value) openingOrder = ++openingSequence
    sync()
  })
  watch(reducedMotion, value => {
    if (!value) return
    stopMotion()
    if (phase.value === 'closing') finishClose()
    else if (phase.value === 'opening') setPhase('open')
  })
  function pageHidden(): void {
    if (!document.hidden) return
    stopMotion()
    if (phase.value === 'closing') finishClose()
    else if (phase.value === 'opening') setPhase('open')
  }
  onMounted(() => { sync(); document.addEventListener?.('visibilitychange', pageHidden) })
  function suspend(): void {
    active = false
    stopMotion()
    setPhase('closed')
    pendingSync.delete(syncKey)
    returnFocus = null
    removeFromStack()
    if (dialog.value?.open) { suspendedCloses += 1; dialog.value.close() }
  }
  onActivated(() => { active = true; void sync() })
  onDeactivated(suspend)
  onBeforeUnmount(() => { suspend(); document.removeEventListener?.('visibilitychange', pageHidden) })
  return { dialog, phase, handleCancel, handleClose, handlePointerDown, handlePointerUp, handlePointerCancel, handleBackdropClick }
}
