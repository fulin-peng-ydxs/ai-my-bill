<script setup lang="ts">
import FormSection from './FormSection.vue'
import { ref } from 'vue'
import { useReceiptSpacing } from '../composables/useReceiptSpacing'
const receipt = ref<globalThis.HTMLElement>()
const extraSpace = useReceiptSpacing(receipt)
</script>

<template>
  <div
    ref="receipt"
    class="entry-form-surface entry-receipt"
    :style="{ '--entry-receipt-extra-space': `${extraSpace}px` }"
  >
    <FormSection
      title="记录内容"
      quiet
    >
      <slot name="subject" />
    </FormSection>
    <FormSection
      title="金额信息"
      quiet
    >
      <slot name="amount" />
      <div
        v-if="$slots.calculation"
        class="entry-receipt-calculation"
      >
        <slot name="calculation" />
      </div>
    </FormSection>
    <FormSection
      title="渠道与时间"
      quiet
    >
      <slot name="context" />
    </FormSection>
    <slot />
  </div>
</template>
