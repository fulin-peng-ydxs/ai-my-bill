<script setup lang="ts">
import FormField from './FormField.vue'

defineProps<{
  fieldId: string
  label: string
  modelValue: string
  tone: 'expense' | 'income'
  disabled?: boolean
  error?: string
  help?: string
}>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <FormField
    :field-id="fieldId"
    class="entry-total-field amount-field"
    :class="`money-${tone}`"
    :label="label"
    :error="error"
    :help="help"
  >
    <template #default="{ describedBy }">
      <span class="amount-field-control">
        <span aria-hidden="true">¥</span>
        <input
          :id="fieldId"
          :value="modelValue"
          :aria-describedby="describedBy"
          :aria-invalid="Boolean(error) || undefined"
          :disabled="disabled"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0"
          @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        >
      </span>
    </template>
    <template
      v-if="$slots.help"
      #help
    >
      <slot name="help" />
    </template>
  </FormField>
</template>
