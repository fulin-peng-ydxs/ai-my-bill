import { onBeforeUnmount, onDeactivated, watch, type Ref } from 'vue'
import { motionMilliseconds } from './motion'
import { useKeyboardViewport } from './useKeyboardViewport'
import { useMotionPreference } from './useMotionPreference'

/** 保留原生 details/summary 的键盘与可访问语义，只为小范围展开补充过渡。 */
export function useDisclosureMotion(details: Ref<HTMLDetailsElement | undefined>, mustOpen: () => boolean = () => false) {
  const reduced = useMotionPreference()
  const { keyboardOpen } = useKeyboardViewport()
  let animation: Animation | undefined
  let targetOpen = false
  let overflow = ''
  function cancel(): void {
    if (!animation) return
    animation.cancel()
    animation = undefined
    if (details.value) details.value.style.overflow = overflow
  }
  function finish(): void {
    if (!animation) return
    cancel()
    if (details.value) details.value.open = mustOpen() || targetOpen
  }
  function toggle(event: MouseEvent): void {
    const element = details.value
    if (!element) return
    event.preventDefault()
    const opening = animation ? !targetOpen : !element.open
    const start = element.getBoundingClientRect().height
    cancel()
    targetOpen = mustOpen() || opening
    if (mustOpen() || reduced.value || keyboardOpen.value || !element.animate) { element.open = targetOpen; return }
    overflow = element.style.overflow
    element.open = targetOpen
    const end = element.getBoundingClientRect().height
    const duration = motionMilliseconds(element, '--motion-standard')
    // 长内容避免大范围布局插值；错误与软键盘始终走即时路径。
    if (!duration || Math.max(start, end) > 480 || start === end) return
    element.open = true
    element.style.overflow = 'hidden'
    const current = element.animate([{ height: `${start}px` }, { height: `${end}px` }], {
      duration, easing: getComputedStyle(element).getPropertyValue('--motion-ease-move').trim(),
    })
    animation = current
    void current.finished.then(() => { if (animation === current) finish() }, () => {})
  }
  watch([reduced, keyboardOpen, mustOpen], () => {
    finish()
    if (mustOpen() && details.value) details.value.open = true
  })
  onDeactivated(finish)
  onBeforeUnmount(cancel)
  return { toggle }
}
