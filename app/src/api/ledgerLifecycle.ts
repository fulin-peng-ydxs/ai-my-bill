import type { LedgerContracts } from '../domain/ledgerContracts'
import { LifecycleService } from '../data/entries/lifecycleService'
import { appDatabase } from '../data/appDatabase'
import { useBootstrapStore } from '../stores/bootstrap'
import { mutateEntry } from './localEntries'
const service = new LifecycleService(appDatabase)

export type LedgerLifecycleResponse = LedgerContracts['LedgerLifecycleResponse']
export type LedgerLifecycleAction = 'trash' | 'restore' | 'purge'

/** 账目和调整共享同一生命周期客户端，差异仅体现在稳定资源路径。 */
export function changeLedgerLifecycle(
  item: { id: string, entryType: 'EXPENSE' | 'INCOME' | 'ADJUSTMENT', version: number },
  action: LedgerLifecycleAction,
  idempotencyKey: string,
  includeAdjustments = false,
): Promise<LedgerLifecycleResponse | undefined> {
  const dataset = useBootstrapStore().datasetId
  return mutateEntry(() => service.change(dataset, item, action, idempotencyKey, includeAdjustments))
}
