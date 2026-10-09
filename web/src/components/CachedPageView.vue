<script setup lang="ts">
import { pageScrollTop, scrollPageTo } from '../composables/pageScroll'
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, provide, ref, shallowReactive, watch, type VNode } from 'vue'
import { onBeforeRouteLeave, routeLocationKey, useRouter, type RouteLocationNormalizedLoaded } from 'vue-router'

import { pageActivityKey } from '../composables/usePageActivity'
import { pageCacheKey } from '../app/pageCache'

const props = defineProps<{ component: VNode, route: RouteLocationNormalizedLoaded }>()
const router = useRouter()
// 缓存页只订阅自己的路由上下文，避免隐藏页响应另一页的参数、筛选和返回来源。
const localRoute = shallowReactive({ ...props.route })
provide(routeLocationKey, localRoute)
watch(() => props.route, (route) => Object.assign(localRoute, route), { flush: 'sync' })
let scroll = 0
let frame: number | undefined
const active = ref(true)
provide(pageActivityKey, active)
onBeforeRouteLeave(() => { scroll = pageScrollTop() })
onActivated(async () => {
  active.value = true
  await nextTick()
  if (!active.value) return
  // 等缓存 DOM 重新进入布局后恢复，避免被旧页面的滚动高度截断。
  frame = globalThis.requestAnimationFrame(() => {
    frame = undefined
    if (active.value && pageCacheKey(router.currentRoute.value) === pageCacheKey(localRoute)) scrollPageTo(scroll)
  })
})
function suspend(): void {
  active.value = false
  if (frame !== undefined) globalThis.cancelAnimationFrame(frame)
  frame = undefined
}
onDeactivated(suspend)
onBeforeUnmount(suspend)
</script>

<template>
  <component
    :is="component"
    class="cached-page"
  />
</template>
