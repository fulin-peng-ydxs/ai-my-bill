import type { LedgerContracts } from '../domain/ledgerContracts'
import { TemplateService } from '../data/personal/templateService'
import { appDatabase } from '../data/appDatabase'
import { useBootstrapStore } from '../stores/bootstrap'
import { localOperation } from '../data/localOperation'

export type DailyTemplateSummary = LedgerContracts['DailyTemplateSummary']
export type DailyTemplateSelection = LedgerContracts['DailyTemplateSelection']
export type DailyTemplateList = LedgerContracts['DailyTemplateList']
export type DailyTemplateEntryType = LedgerContracts['EntryType']
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
