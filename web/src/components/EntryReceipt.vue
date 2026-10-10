<script setup lang="ts">
import FormSection from './FormSection.vue'
</script>

<template>
  <div class="entry-form-surface entry-receipt">
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
