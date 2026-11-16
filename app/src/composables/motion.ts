/** 退场 DOM 仅用于呈现，不能继续接收键盘或触摸操作。 */
export function deactivateLeavingElement(element: Element): void { element.setAttribute('inert', '') }
export function activateEnteringElement(element: Element): void { element.removeAttribute('inert') }

/** 脚本只读取 CSS token，缺少样式/动画能力时立即完成，不另维护一份数值。 */
export function motionMilliseconds(element: Element, token: string): number {
  const value = globalThis.getComputedStyle?.(element).getPropertyValue(token).trim() ?? ''
  const amount = Number.parseFloat(value)
  return Number.isFinite(amount) ? amount * (value.endsWith('ms') ? 1 : 1000) : 0
}

/** 动画事件、取消与有界超时共同收尾；取消订阅本身不会执行过期回调。 */
export function afterMotion(element: HTMLElement | null | undefined, done: () => void): () => void {
  if (!element || !globalThis.getComputedStyle) { done(); return () => {} }
  const style = getComputedStyle(element)
  const times = (value: string) => value.split(',').map(part => Number.parseFloat(part) * (part.trim().endsWith('ms') ? 1 : 1000) || 0)
  const durations = times(style.animationDuration)
  const delays = times(style.animationDelay)
  const duration = Math.max(0, ...durations.map((value, index) => value + delays[index % delays.length]!))
  if (!duration || style.animationName === 'none') { done(); return () => {} }
  let pending = true
  function cancel(): void {
    pending = false
    clearTimeout(timer)
    element!.removeEventListener('animationend', finish)
    element!.removeEventListener('animationcancel', finish)
  }
  function finish(event?: Event): void {
    if (!pending || (event && event.target !== element)) return
    if (event && 'animationName' in event && event.animationName !== style.animationName) return
    cancel()
    done()
  }
  element.addEventListener('animationend', finish)
  element.addEventListener('animationcancel', finish)
  // 后台节流或样式被移除也不得留下永久的关闭中弹层。
  const timer = setTimeout(finish, duration + 64)
  return cancel
}
