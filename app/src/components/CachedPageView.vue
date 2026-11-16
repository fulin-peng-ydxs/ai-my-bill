<script setup lang="ts">
import { pageScrollTop, scrollPageTo } from '../composables/pageScroll'
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, provide, ref, shallowReactive, watch, type VNode, type ComponentPublicInstance } from 'vue'
import { onBeforeRouteLeave, routeLocationKey, useRouter, type RouteLocationNormalizedLoaded } from 'vue-router'

import { pageActivityKey } from '../composables/usePageActivity'
import { pageCacheKey } from '../app/pageCache'
import { pageMotionKey, useContentMotion, type ContentMotion } from '../composables/useContentMotion'

const props = defineProps<{ component: VNode, route: RouteLocationNormalizedLoaded, motion?: ContentMotion }>()
const view = ref<ComponentPublicInstance>()
const entering = ref(true)
provide(pageMotionKey, entering)
const contentMotion = useContentMotion()
const router = useRouter()
// 缓存页只订阅自己的路由上下文，避免隐藏页响应另一页的参数、筛选和返回来源。
const localRoute = shallowReactive({ ...props.route })
provide(routeLocationKey, localRoute)
watch(() => props.route, (route) => Object.assign(localRoute, route), { flush: 'sync' })
let scroll = 0
let frame: number | undefined
let activation = 0
const active = ref(true)
provide(pageActivityKey, active)
onBeforeRouteLeave(() => { scroll = pageScrollTop() })
onActivated(async () => {
  const current = ++activation
  active.value = true
  entering.value = true
  await nextTick()
  if (!active.value) return
  // 等缓存 DOM 重新进入布局后恢复，避免被旧页面的滚动高度截断。
  frame = globalThis.requestAnimationFrame(() => {
    frame = undefined
    if (active.value && pageCacheKey(router.currentRoute.value) === pageCacheKey(localRoute)) {
      scrollPageTo(scroll)
      const root = view.value?.$el
      const content = root instanceof globalThis.HTMLElement ? root.querySelector<globalThis.HTMLElement>('[data-page-scroll]') ?? root : undefined
      void contentMotion.play(content, props.motion, true).then(() => {
        if (activation === current) entering.value = false
      })
    }
  })
})
function suspend(): void {
  activation += 1
  active.value = false
  entering.value = false
  contentMotion.cancel()
  if (frame !== undefined) globalThis.cancelAnimationFrame(frame)
  frame = undefined
}
onDeactivated(suspend)
onBeforeUnmount(suspend)
</script>

<template>
  <component
    :is="component"
    ref="view"
    class="cached-page"
  />
</template>
