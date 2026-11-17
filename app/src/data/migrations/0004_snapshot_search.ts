import type { SqlSession } from '../ledgerDatabase'
import { normalizedDictionaryName } from '../../domain/dictionaryNameV1'

/** 与 DDL/履历同事务，按稳定 ID 分批；失败全部回滚，重启可重跑，不加载整个账本。 */
export async function backfillSnapshotSearch(sql: SqlSession): Promise<void> {
  let after = ''
  while (true) {
    const rows = await sql.query(`SELECT id,product_name_snapshot FROM ledger_entry
      WHERE entry_type='EXPENSE' AND product_name_snapshot IS NOT NULL AND id>?
      ORDER BY id LIMIT 200`, [after])
    if (!rows.length) {
      return
    }
    for (const row of rows) {
      await sql.run('UPDATE ledger_entry SET normalized_product_name_snapshot=? WHERE id=?',
        [normalizedDictionaryName(String(row.product_name_snapshot)), String(row.id)])
    }
    after = String(rows.at(-1)!.id)
  }
}
