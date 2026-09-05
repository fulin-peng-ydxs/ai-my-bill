<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  fieldId: string
  label: string
  help?: string
  error?: string
}>()

const helpId = computed(() => props.help ? `${props.fieldId}-help` : undefined)
const errorId = computed(() => props.error ? `${props.fieldId}-error` : undefined)
const describedBy = computed(() => [helpId.value, errorId.value].filter(Boolean).join(' ') || undefined)
</script>

<template>
  <div class="form-field">
    <label :for="fieldId">{{ label }}</label>
    <slot :described-by="describedBy" />
    <small
      v-if="help"
      :id="helpId"
    >{{ help }}</small>
    <small
      v-if="error"
      :id="errorId"
      class="field-error"
      role="alert"
    >{{ error }}</small>
  </div>
</template>
