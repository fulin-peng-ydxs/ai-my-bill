import type { components } from '../api/generated/schema'

export type Preferences = components['schemas']['PreferenceResponse']
export type PreferenceRequest = components['schemas']['PreferenceRequest']
export type LedgerDefaultRange = components['schemas']['LedgerDefaultRange']
export type ReportDefaultRange = components['schemas']['ReportDefaultRange']
export type EntryType = components['schemas']['EntryType']

export const DEFAULT_PREFERENCES: PreferenceRequest = Object.freeze({
  defaultFundingChannelId: null,
  ledgerDefaultRange: 'TODAY',
  reportDefaultRange: 'THIS_MONTH',
  themeMode: 'SYSTEM',
  recentEntryType: 'EXPENSE',
})

export const ledgerRangeOptions = [
  { value: 'TODAY', label: '今天' },
  { value: 'THIS_WEEK', label: '本周' },
  { value: 'THIS_MONTH', label: '本月' },
] as const

export const reportRangeOptions = [
  { value: 'THIS_WEEK', label: '本周' },
  { value: 'THIS_MONTH', label: '本月' },
  { value: 'LAST_MONTH', label: '上月' },
  { value: 'THIS_YEAR', label: '今年' },
] as const

const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function preferenceLabel(
  options: readonly { value: string, label: string }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? '默认'
}

export function normalizePreferences(value: unknown): PreferenceRequest {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PREFERENCES }
  const candidate = value as Partial<PreferenceRequest>
  return {
    defaultFundingChannelId: typeof candidate.defaultFundingChannelId === 'string'
      && UUID_PATTERN.test(candidate.defaultFundingChannelId)
      ? candidate.defaultFundingChannelId
      : null,
    ledgerDefaultRange: ledgerRangeOptions.some((item) => item.value === candidate.ledgerDefaultRange)
      ? candidate.ledgerDefaultRange as LedgerDefaultRange
      : DEFAULT_PREFERENCES.ledgerDefaultRange,
    reportDefaultRange: reportRangeOptions.some((item) => item.value === candidate.reportDefaultRange)
      ? candidate.reportDefaultRange as ReportDefaultRange
      : DEFAULT_PREFERENCES.reportDefaultRange,
    themeMode: ['SYSTEM', 'LIGHT', 'DARK'].includes(candidate.themeMode ?? '')
      ? candidate.themeMode as PreferenceRequest['themeMode']
      : DEFAULT_PREFERENCES.themeMode,
    recentEntryType: ['EXPENSE', 'INCOME'].includes(candidate.recentEntryType ?? '')
      ? candidate.recentEntryType as EntryType
      : DEFAULT_PREFERENCES.recentEntryType,
  }
}
