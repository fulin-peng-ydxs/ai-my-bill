import type { SqlSession } from '../ledgerDatabase'
import { entrySearchText, adjustmentSourceSearchText, adjustmentSearchText } from '../../domain/ledgerSearchV1'

/** 按 ID 每批最多 200 行回填，沿用历史名称；任何失败连同 DDL/迁移履历整体回滚。 */
export async function backfillLedgerSearch(sql: SqlSession): Promise<void> {
  for (const table of ['ledger_entry', 'expense_adjustment']) {
    let after = ''
    while (true) {
      const rows = await sql.query(`SELECT * FROM ${table} WHERE id>? ORDER BY id LIMIT 200`, [after])
      if (!rows.length) break
      for (const row of rows) {
        if (table === 'ledger_entry') {
          await sql.run('UPDATE ledger_entry SET search_text=?,adjustment_source_search_text=? WHERE id=?',
            [entrySearchText(row), adjustmentSourceSearchText(row), String(row.id)])
        } else {
          await sql.run('UPDATE expense_adjustment SET search_text=? WHERE id=?', [adjustmentSearchText(row), String(row.id)])
        }
      }
      after = String(rows.at(-1)!.id)
    }
  }
}
