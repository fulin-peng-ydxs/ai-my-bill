import type { ExportRequest } from '../../api/exports'
import type { LedgerFilters } from '../../api/ledgerEntries'
import type { LedgerDatabase } from '../ledgerDatabase'
import type { LedgerTransfers } from '../../platform/ledgerTransfers'
import { compileLedgerFilter, readbackProjection, allExportProjection } from '../entries/querySql'
import { scaledIntegerToDecimal, fromSqliteInteger } from '../../domain/money'
import { throwIfCancelled } from '../../domain/localError'

// 沿用原 CSV 的列顺序；完整备份另以整库文件保存，不把 CSV 当恢复格式。
export const csvHeaders = ['记录ID','记录类型','调整类型','关联账目ID','关联账目名称','状态','业务时间','业务日期',
  '商品名称','收入名称','付款方','支出一级分类','支出二级分类','收入分类','单位','单价','数量','计算金额','实付金额','收入金额',
  '调整金额','资金渠道','购买渠道','地点','备注','商品ID','付款方ID','支出一级分类ID','支出二级分类ID','收入分类ID','单位ID',
  '资金渠道ID','购买渠道ID','地点ID','版本','创建时间','更新时间','删除时间','清理时间']

export function csvRow(values: unknown[]): string {
  return values.map(value => {
    let text = value == null ? '' : String(value)
    // 与旧导出一致：前导空白后的公式字符也加文本前缀，所有列均转义。
    if (/^[\s]*[=+\-@\t\r]/u.test(text)) text = `'${text}`
    return `"${text.replaceAll('"','""')}"`
  }).join(',') + '\r\n'
}

function shanghai(value: unknown): string {
  if (!value) return ''
  const date = new Date(String(value))
  if (!Number.isFinite(date.getTime())) throw new Error('导出日期无效。')
  return new Date(date.getTime() + 8 * 3600_000).toISOString().replace('Z', '+08:00')
}
function decimal(value: unknown, scale: number): string {
  return value == null || value === '' ? '' : scaledIntegerToDecimal(fromSqliteInteger(String(value)), scale)
}

/** 单一读事务、有界批次、三元游标；同时间/跨类型 ID 不漏行，不一次展开账本。 */
export async function writeCsv(db: LedgerDatabase, files: LedgerTransfers, request: ExportRequest, signal?: AbortSignal) {
  const { id } = await files.createTransfer({ kind: 'csv' })
  try {
    let rows = 0
    await db.readSnapshot(async sql => {
      let where = '1=1', values: (string | number | null)[] = []
      if (request.scope === 'CURRENT_FILTERS') {
        const { scope: _, ...filters } = request
        const compiled = compileLedgerFilter(filters as LedgerFilters, new Date())
        where = compiled.conditions.join(' AND ')
        values = compiled.values
      }
      const projection = request.scope === 'ALL_DATA' ? allExportProjection : readbackProjection
      await files.appendTransfer({ id, text: '\uFEFF' + csvRow(csvHeaders) })
      let cursor: [string, string, string] | undefined
      while (true) {
        throwIfCancelled(signal)
        const batch = await sql.query(`SELECT q.*,d.product_name_snapshot AS product,d.payer_name_snapshot AS payer,
          d.primary_category_name_snapshot AS primary_name,d.secondary_category_name_snapshot AS secondary_name,
          d.income_category_name_snapshot AS income_category,CAST(d.unit_price_scaled AS TEXT) AS price,
          CAST(d.calculated_amount_cents AS TEXT) AS calculated,d.purchase_channel_name_snapshot AS purchase,
          d.location_label_name_snapshot AS location,d.updated_at AS entry_updated,a.status AS adjustment_status,a.updated_at AS adjustment_updated
          FROM (SELECT * FROM (${projection}) WHERE ${where}
          ${cursor ? 'AND (business_time,entry_type,id)>(?,?,?)' : ''}
          ORDER BY business_time,entry_type,id LIMIT 200) q
          LEFT JOIN ledger_entry d ON d.id=q.id AND q.entry_type<>'ADJUSTMENT'
          LEFT JOIN expense_adjustment a ON a.id=q.id AND q.entry_type='ADJUSTMENT'
          ORDER BY q.business_time,q.entry_type,q.id`, [...values, ...(cursor ?? [])])
        let buffer = ''
        for (const row of batch) {
          throwIfCancelled(signal)
          const expense = row.entry_type === 'EXPENSE', income = row.entry_type === 'INCOME', adjustment = row.entry_type === 'ADJUSTMENT'
          const text = csvRow([row.id,row.entry_type,row.adjustment_type,row.original_expense_id,adjustment ? row.title : null,
            adjustment ? row.adjustment_status : row.lifecycle_status,shanghai(row.business_time),row.business_date,
            expense ? row.product : null,income ? row.income_name : null,income ? row.payer : null,
            expense ? row.primary_name : null,expense ? row.secondary_name : null,income ? row.income_category : null,
            expense ? row.unit_name_snapshot : null,expense ? decimal(row.price,4) : null,expense ? decimal(row.quantity_text,3) : null,
            expense ? decimal(row.calculated,2) : null,expense ? decimal(row.amount_text,2) : null,income ? decimal(row.amount_text,2) : null,
            adjustment ? decimal(row.amount_text,2) : null,adjustment ? null : row.funding_channel_name_snapshot,
            expense ? row.purchase : null,expense ? row.location : null,row.note,
            expense ? row.product_id : null,income ? row.payer_id : null,expense ? row.primary_category_id : null,
            expense ? row.secondary_category_id : null,income ? row.income_category_id : null,expense ? row.unit_id : null,
            adjustment ? null : row.funding_channel_id,expense ? row.purchase_channel_id : null,expense ? row.location_label_id : null,
            row.row_version,shanghai(row.created_at),shanghai(adjustment ? row.adjustment_updated : row.entry_updated),shanghai(row.deleted_at),shanghai(row.purge_after)])
          if (buffer.length + text.length > 32000) {
            await files.appendTransfer({ id,text: buffer })
            buffer = ''
          }
          buffer += text
          rows++
        }
        if (buffer) await files.appendTransfer({ id,text: buffer })
        if (batch.length < 200) break
        const last = batch.at(-1)!
        cursor = [String(last.business_time),String(last.entry_type),String(last.id)]
      }
    }, signal)
    return { id, rows }
  } catch (error) {
    try { await files.discardTransfer({ id }) }
    catch (cleanup) { throw new AggregateError([error,cleanup], '导出失败且临时文件清理失败。') }
    throw error
  }
}
