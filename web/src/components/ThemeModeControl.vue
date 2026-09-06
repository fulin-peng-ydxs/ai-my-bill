<script setup lang="ts">
import { computed } from 'vue'

import { useThemeStore } from '../stores/theme'
import { usePreferencesStore } from '../stores/preferences'
import { useSessionStore } from '../stores/session'
import { themeModes, themeModeLabel, type ThemeMode } from '../theme/theme'
import SegmentedControl from './SegmentedControl.vue'

const props = defineProps<{ disabled?: boolean }>()
const theme = useThemeStore()
const preferences = usePreferencesStore()
const session = useSessionStore()
const selectedLabel = computed(() => themeModeLabel(theme.mode))
const options = computed(() => themeModes.map((mode) => ({
  value: mode, label: themeModeLabel(mode), disabled: props.disabled,
})))

function select(mode: ThemeMode): void {
  theme.setMode(mode)
  if (session.session?.role === 'USER' && preferences.accountId === session.session.accountId) {
    void preferences.update({ themeMode: mode.toUpperCase() as 'SYSTEM' | 'LIGHT' | 'DARK' })
      .catch(() => undefined)
  }
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
