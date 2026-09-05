<script setup lang="ts">
import { computed } from 'vue'

import { useThemeStore } from '../stores/theme'
import { themeModes, themeModeLabel, type ThemeMode } from '../theme/theme'

const theme = useThemeStore()
const selectedLabel = computed(() => themeModeLabel(theme.mode))

function select(mode: ThemeMode): void {
  theme.setMode(mode)
}
</script>

<template>
  <fieldset
    class="theme-control"
    data-testid="theme-mode-control"
  >
    <legend class="sr-only">
      主题模式，当前为{{ selectedLabel }}
    </legend>
    <button
      v-for="mode in themeModes"
      :key="mode"
      type="button"
      :aria-pressed="theme.mode === mode"
      :data-theme-option="mode"
      @click="select(mode)"
    >
      {{ themeModeLabel(mode) }}
    </button>
  </fieldset>
</template>
