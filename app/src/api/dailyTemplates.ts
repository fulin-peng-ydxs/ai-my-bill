import type { components } from './generated/schema'
import { apiRequest } from './http'

export type DailyTemplateSummary = components['schemas']['DailyTemplateSummary']
export type DailyTemplateSelection = components['schemas']['DailyTemplateSelection']
export type DailyTemplateList = components['schemas']['DailyTemplateList']
export type DailyTemplateEntryType = components['schemas']['EntryType']

export function listDailyTemplates(type: DailyTemplateEntryType, signal?: AbortSignal): Promise<DailyTemplateList> {
  const params = new URLSearchParams({ type })
  return apiRequest(`/daily-templates?${params}`, { signal })
}

export function selectDailyTemplate(templateId: string): Promise<DailyTemplateSelection> {
  return apiRequest(`/daily-templates/${encodeURIComponent(templateId)}/select`, { method: 'POST' })
}

export function removeDailyTemplate(templateId: string): Promise<void> {
  return apiRequest(`/daily-templates/${encodeURIComponent(templateId)}`, { method: 'DELETE' })
}

/** T14 的明细上下文操作复用此契约；T13 只提供选择器，不提前暴露明细入口。 */
export function upsertDailyTemplateFromLedger(ledgerId: string): Promise<DailyTemplateSummary> {
  return apiRequest(`/ledger-entries/${encodeURIComponent(ledgerId)}/daily-template`, { method: 'PUT' })
}
