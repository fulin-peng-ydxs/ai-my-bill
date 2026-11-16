import { onBeforeUnmount, onMounted, readonly, ref } from 'vue'

const reduced = ref(false)
let consumers = 0
let media: MediaQueryList | undefined
function update(): void { reduced.value = media?.matches ?? false }

/** CSS 与脚本共用系统偏好；仅保留一个监听，最后一个消费者离开时释放。 */
export function useMotionPreference() {
  onMounted(() => {
    if (consumers++ > 0) return
    media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    update()
    media?.addEventListener('change', update)
  })
  onBeforeUnmount(() => {
    if (--consumers > 0) return
    media?.removeEventListener('change', update)
    media = undefined
    reduced.value = false
  })
  return readonly(reduced)
}
