<script setup lang="ts">
import type { PageRegistration } from '../app/pageRegistry'

defineProps<{
  page: PageRegistration
}>()
</script>

<template>
  <article
    class="placeholder-page"
    :data-page-key="page.pageKey"
  >
    <h1>{{ page.title }}</h1>
    <p>工程基线已接入，业务能力将在对应计划阶段实现。</p>
    <section
      class="placeholder-panel"
      aria-label="页面契约"
    >
      <p>当前页面只验证路由、权限元数据、页面登记和响应式外壳，不包含模拟业务数据。</p>
      <dl class="placeholder-meta">
        <dt>页面类型</dt>
        <dd>{{ page.archetype }}</dd>
        <dt>访问角色</dt>
        <dd>{{ page.role }}</dd>
        <dt>原型依据</dt>
        <dd>{{ page.prototype }}</dd>
        <dt>状态契约</dt>
        <dd>{{ page.states.join(' / ') }}</dd>
      </dl>
    </section>
  </article>
</template>
