<script setup lang="ts">
import { ref, watch, type Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import SectionTitle from './SectionTitle.vue'

const props = defineProps<{ title: string, summary: string, invalid?: boolean, icon?: Component }>()
const expanded = ref(false)
// 折叠只降低低频字段的视觉权重，校验失败仍必须让错误立即可见。
watch(() => props.invalid, (invalid) => { if (invalid) expanded.value = true }, { immediate: true })

function toggled(event: globalThis.Event): void {
  const details = event.target as globalThis.HTMLDetailsElement
  // 错误尚未修正时保持可见，避免再次提交同一错误却因 invalid 未变化而藏在折叠区。
  if (props.invalid && !details.open) details.open = true
  expanded.value = details.open
}
</script>

<template>
  <details
    class="form-section form-disclosure"
    :open="expanded"
    @toggle="toggled"
  >
    <summary>
      <span>
        <SectionTitle
          as="strong"
          :title="title"
          :icon="icon"
        />
        <small>{{ summary }}</small>
      </span>
      <ChevronDown
        :size="18"
        aria-hidden="true"
      />
    </summary>
    <div class="form-section-fields">
      <slot />
    </div>
  </details>
</template>
