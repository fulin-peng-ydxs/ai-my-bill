import { appDatabase } from '../data/appDatabase'
import { EntryService } from '../data/entries/entryService'
import { localOperation } from '../data/localOperation'

export const entries = new EntryService(appDatabase)
export const LEDGER_CHANGED_EVENT = 'my-bill:ledger-changed'

/** 只有业务事务和幂等回执成功提交，才使明细/报表缓存失效。 */
export function mutateEntry<T>(operation: () => Promise<T>): Promise<T> {
  return localOperation(async () => {
    const result = await operation()
    if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      globalThis.dispatchEvent(new CustomEvent(LEDGER_CHANGED_EVENT))
    }
    return result
  })
}
