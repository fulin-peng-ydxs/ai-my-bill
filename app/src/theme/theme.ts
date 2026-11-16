export const themeModes = ['system', 'light', 'dark'] as const

export type ThemeMode = (typeof themeModes)[number]
export type ResolvedTheme = Exclude<ThemeMode, 'system'>

export const THEME_STORAGE_KEY = 'my-bill-theme-mode'

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && themeModes.includes(value as ThemeMode)
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode
}

export function themeModeLabel(mode: ThemeMode): string {
  return { system: '跟随系统', light: '白天', dark: '夜晚' }[mode]
}
