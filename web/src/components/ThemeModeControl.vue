<script setup lang="ts">
import { computed } from 'vue'

import { useThemeStore } from '../stores/theme'
import { themeModes, themeModeLabel, type ThemeMode } from '../theme/theme'
import SegmentedControl from './SegmentedControl.vue'

const theme = useThemeStore()
const selectedLabel = computed(() => themeModeLabel(theme.mode))
const options = themeModes.map((mode) => ({ value: mode, label: themeModeLabel(mode) }))

function select(mode: ThemeMode): void {
  theme.setMode(mode)
}
</script>

<template>
  <SegmentedControl
    class="theme-control"
    data-testid="theme-mode-control"
    :label="`主题模式，当前为${selectedLabel}`"
    :model-value="theme.mode"
    :options="options"
    @update:model-value="select($event as ThemeMode)"
  />
</template>
