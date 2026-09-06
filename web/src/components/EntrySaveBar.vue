<script setup lang="ts">
defineProps<{ submitting: boolean, primaryLabel: string }>()
defineEmits<{ continue: [] }>()
</script>

<template>
  <div class="entry-savebar">
    <button
      type="button"
      class="secondary-button"
      :disabled="submitting"
      @click="$emit('continue')"
    >
      {{ submitting ? '保存中…' : '保存并继续' }}
    </button>
    <button
      type="submit"
      class="primary-button"
      :disabled="submitting"
    >
      {{ submitting ? '保存中…' : primaryLabel }}
    </button>
  </div>
</template>
