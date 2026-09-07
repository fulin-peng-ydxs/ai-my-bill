import type { components } from './generated/schema'
import { apiRequest } from './http'

export type LedgerLifecycleResponse = components['schemas']['LedgerLifecycleResponse']
export type LedgerLifecycleAction = 'trash' | 'restore' | 'purge'

/** 账目和调整共享同一生命周期客户端，差异仅体现在稳定资源路径。 */
export function changeLedgerLifecycle(
  item: { id: string, entryType: 'EXPENSE' | 'INCOME' | 'ADJUSTMENT', version: number },
  action: LedgerLifecycleAction,
  idempotencyKey: string,
): Promise<LedgerLifecycleResponse | undefined> {
  const resource = item.entryType === 'ADJUSTMENT' ? 'adjustments' : 'ledger-entries'
  return apiRequest(`/${resource}/${encodeURIComponent(item.id)}/${action}`, {
    method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ version: item.version }),
  })
}
