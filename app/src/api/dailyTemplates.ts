import type { components } from './generated/schema'
import { TemplateService } from '../data/personal/templateService'
import { appDatabase } from '../data/appDatabase'
import { useBootstrapStore } from '../stores/bootstrap'
import { localOperation } from '../data/localOperation'

export type DailyTemplateSummary = components['schemas']['DailyTemplateSummary']
export type DailyTemplateSelection = components['schemas']['DailyTemplateSelection']
export type DailyTemplateList = components['schemas']['DailyTemplateList']
export type DailyTemplateEntryType = components['schemas']['EntryType']
const service = new TemplateService(appDatabase)

export function listDailyTemplates(type: DailyTemplateEntryType, signal?: AbortSignal): Promise<DailyTemplateList> {
  const dataset = useBootstrapStore().datasetId
  return localOperation(() => service.list(dataset, type, signal))
}
export function selectDailyTemplate(id: string): Promise<DailyTemplateSelection> {
  const dataset = useBootstrapStore().datasetId
  return localOperation(() => service.select(dataset, id))
}
export function removeDailyTemplate(id: string): Promise<void> {
  const dataset = useBootstrapStore().datasetId
  return localOperation(() => service.remove(dataset, id))
}
export function upsertDailyTemplateFromLedger(id: string): Promise<DailyTemplateSummary> {
  const dataset = useBootstrapStore().datasetId
  return localOperation(() => service.upsert(dataset, id))
}
