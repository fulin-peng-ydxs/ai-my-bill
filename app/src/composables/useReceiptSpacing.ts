import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch, type Ref } from 'vue'
import { useKeyboardViewport } from './useKeyboardViewport'

/** 只分配可用余量；长内容保持自然高度，每个分组的额外留白有界。 */
export function receiptExtraSpace(available: number, natural: number, sections: number, heightLimit: number, spaceLimit: number): number {
  if (sections <= 0) return 0
  return Math.max(0, Math.min(spaceLimit, (Math.min(available, heightLimit) - natural) / (sections * 2)))
}

/** 伸展由正文空间决定，补充信息展开不重新分配上方留白，避免折叠动画牵动整张票据。 */
export function useReceiptSpacing(receipt: Ref<HTMLElement | undefined>) {
  const extraSpace = ref(0)
  const { keyboardOpen } = useKeyboardViewport()
  let observer: ResizeObserver | undefined
  let frame: number | undefined
  let active = true
  function cancel(): void {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }
  function measure(): void {
    frame = undefined
    const element = receipt.value
    const region = element?.closest<HTMLElement>('.scroll-region-body')
    if (!active || !element || !region?.clientHeight) return
    if (keyboardOpen.value || !region.classList.contains('workspace-body-fill')) { extraSpace.value = 0; return }
    const style = getComputedStyle(element)
    const number = (value: string) => Number.parseFloat(value) || 0
    const sections = Array.from(element.children).filter(child => child.tagName === 'SECTION')
    // 用折叠摘要的高度建立基线，绝不读取正在插值的 details 高度。
    let natural = number(style.borderTopWidth) + number(style.borderBottomWidth)
    for (const child of element.children) {
      if (child instanceof HTMLDetailsElement) {
        const childStyle = getComputedStyle(child)
        natural += (child.querySelector('summary')?.getBoundingClientRect().height ?? 0)
          + number(childStyle.paddingTop) + number(childStyle.paddingBottom)
          + number(childStyle.borderTopWidth) + number(childStyle.borderBottomWidth)
      } else natural += child.getBoundingClientRect().height
    }
    natural -= extraSpace.value * sections.length * 2
    let after = 0
    // 提示、刚保存摘要等继续占据各自的自然空间，不被票据伸展挤出正文。
    for (let node: HTMLElement = element; node.parentElement && node !== region; node = node.parentElement) {
      const gap = number(getComputedStyle(node.parentElement).rowGap)
      for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        const height = sibling.getBoundingClientRect().height
        if (height) after += height + gap
      }
    }
    const top = element.getBoundingClientRect().top - region.getBoundingClientRect().top + region.scrollTop
    const available = region.clientHeight - top - number(getComputedStyle(region).paddingBottom) - after
    extraSpace.value = receiptExtraSpace(available, natural, sections.length,
      number(style.getPropertyValue('--entry-receipt-max-height')), number(style.getPropertyValue('--entry-receipt-space-limit')))
  }
  function schedule(): void {
    if (active && frame === undefined) frame = requestAnimationFrame(measure)
  }
  function connect(): void {
    if (!active) return
    cancel()
    observer?.disconnect()
    const region = receipt.value?.closest('.scroll-region-body')
    if (!region) return
    measure()
    observer = new ResizeObserver(schedule)
    observer.observe(region)
  }
  function suspend(): void { active = false; cancel(); observer?.disconnect() }
  onMounted(connect)
  onActivated(() => { active = true; void nextTick(connect) })
  onDeactivated(suspend)
  onBeforeUnmount(suspend)
  watch(keyboardOpen, schedule, { flush: 'post' })
  return extraSpace
}
