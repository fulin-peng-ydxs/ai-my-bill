import type { SqlSession } from '../ledgerDatabase'
import { LocalError } from '../../domain/localError'

/** 在实际执行的同一队列/事务内核对，不能只在排队前比较内存中的 datasetId。 */
export async function assertDataset(sql: SqlSession, datasetId: string): Promise<void> {
  const current = (await sql.query('SELECT dataset_id FROM ledger_meta WHERE singleton=1'))[0]?.dataset_id
  if (!datasetId || current !== datasetId) {
    throw new LocalError('DATASET_CHANGED', '账本已切换，请重新打开当前页面。')
  }
}
