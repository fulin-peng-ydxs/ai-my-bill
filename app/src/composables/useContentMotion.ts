import { inject, onBeforeUnmount, onDeactivated, watch, type InjectionKey, type Ref } from 'vue'
import { motionMilliseconds } from './motion'
import { useMotionPreference } from './useMotionPreference'
import { usePageActivity } from './usePageActivity'

export const pageMotionKey: InjectionKey<Ref<boolean>> = Symbol('page-motion')
export type ContentMotion = 'fade' | 'forward' | 'back'

/** 在已就绪的单份内容上播放；取消旧动画，不影响缓存、请求或滚动恢复。 */
export function useContentMotion() {
  const reduced = useMotionPreference()
  const active = usePageActivity()
  const pageEntering = inject(pageMotionKey, undefined)
  let animation: Animation | undefined
  function cancel(): void { animation?.cancel(); animation = undefined }
  async function play(element: HTMLElement | undefined | null, effect: ContentMotion = 'fade', page = false): Promise<void> {
    cancel()
    if (!element?.animate || !active.value || reduced.value || document.hidden || (!page && pageEntering?.value)) return
    const duration = motionMilliseconds(element, effect === 'fade' ? '--motion-switch' : '--motion-standard')
    if (!duration) return
    const style = getComputedStyle(element)
    const distance = style.getPropertyValue('--motion-distance').trim()
    const keyframes: Keyframe[] = effect === 'fade' ? [{ opacity: .4 }, { opacity: 1 }]
      : [{ opacity: .4, transform: `translateX(${effect === 'back' ? '-' : ''}${distance})` }, { opacity: 1, transform: 'none' }]
    const current = element.animate(keyframes, { duration, easing: style.getPropertyValue('--motion-ease-enter').trim() })
    animation = current
    try { await current.finished } catch { /* 切页、系统偏好变化或再次操作会正常取消。 */ }
    if (animation === current) { current.cancel(); animation = undefined }
  }
  watch(reduced, value => { if (value) cancel() })
  onDeactivated(cancel)
  onBeforeUnmount(cancel)
  return { play, cancel }
}
