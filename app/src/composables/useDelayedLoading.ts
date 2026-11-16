import { computed, getCurrentInstance, onActivated, onDeactivated, onMounted, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { usePageActivity } from './usePageActivity'

export const READ_LOADING_DELAY_MS = 500

/** 只延迟视觉提示，不延迟请求、结果或交互保护；每段连续等待仅持有一个计时器。 */
export function useDelayedLoading(pending: MaybeRefOrGetter<boolean>, immediate: MaybeRefOrGetter<boolean> = false) {
  const instance = getCurrentInstance()
  const pageActive = instance ? usePageActivity() : ref(true)
  const active = ref(true)
  const elapsed = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  function clear(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    elapsed.value = false
  }
  const start = () => watch(() => Boolean(toValue(pending) && active.value && pageActive.value && !toValue(immediate)), (waiting) => {
    clear()
    if (waiting) timer = setTimeout(() => { timer = undefined; elapsed.value = true }, READ_LOADING_DELAY_MS)
  }, { immediate: true, flush: 'sync' })
  if (instance) {
    onMounted(start)
    onActivated(() => { active.value = true })
    onDeactivated(() => { active.value = false })
  } else start()
  onScopeDispose(clear)
  return computed(() => active.value && pageActive.value && toValue(pending) && (toValue(immediate) || elapsed.value))
}
