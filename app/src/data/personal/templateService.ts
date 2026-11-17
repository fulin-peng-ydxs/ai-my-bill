import type { LedgerDatabase } from '../ledgerDatabase'
import type { DailyTemplateEntryType, DailyTemplateSelection, DailyTemplateSummary } from '../../api/dailyTemplates'
import { expenseResponse, incomeResponse, expenseValues, incomeValues, entryProjection } from '../entries/repository'
import { expenseInput, incomeInput } from '../entries/writePolicy'
import { normalizedDictionaryName } from '../../domain/text'
import { fromSqliteInteger, scaledIntegerToDecimal } from '../../domain/money'
import { LocalError } from '../../domain/localError'
import { requireId } from '../dictionaries/repository'
import { assertDataset } from './datasetScope'

const projection = `SELECT t.*,CAST(amount_cents AS TEXT) AS amount_text,
  CAST(unit_price_scaled AS TEXT) AS price_text,CAST(quantity_scaled AS TEXT) AS quantity_text FROM daily_entry_template t`
// 与原表单回填契约一致；时间、备注、生命周期、调整状态及计算额都不进入模板。
const payload = ['product_id', 'product_name_snapshot', 'primary_category_id', 'primary_category_name_snapshot',
  'secondary_category_id', 'secondary_category_name_snapshot', 'unit_id', 'unit_name_snapshot',
  'unit_price_scaled', 'quantity_scaled', 'purchase_channel_id', 'purchase_channel_name_snapshot',
  'location_label_id', 'location_label_name_snapshot', 'payer_id', 'payer_name_snapshot',
  'income_category_id', 'income_category_name_snapshot', 'income_name', 'amount_cents',
  'funding_channel_id', 'funding_channel_name_snapshot'] as const

/** 模板创建/选择/移除与 T5 商品合并共用同一张表和同一事务队列。 */
export class TemplateService {
  constructor(private readonly database: Pick<LedgerDatabase, 'read' | 'write'>, private readonly clock = () => new Date()) {}

  list(datasetId: string, type: DailyTemplateEntryType, signal?: AbortSignal) {
    if (!['EXPENSE', 'INCOME'].includes(type)) {
      throw new LocalError('VALIDATION_FAILED', '模板类型无效。')
    }
    return this.database.read(async sql => {
      await assertDataset(sql, datasetId)
      const rows = await sql.query(`${projection} WHERE entry_type=? ORDER BY last_used_at DESC,id DESC LIMIT 100`, [type])
      return { items: rows.map(row => this.summary(row)) }
    }, signal)
  }

  upsert(datasetId: string, sourceId: string) {
    requireId(sourceId)
    return this.database.write(async sql => {
      await assertDataset(sql, datasetId)
      const source = (await sql.query(`${entryProjection} WHERE id=? AND lifecycle_status='ACTIVE'`, [sourceId]))[0]
      if (!source) {
        throw new LocalError('DAILY_TEMPLATE_SOURCE_INVALID', '请选择有效的收支账目。')
      }
      const expense = source.entry_type === 'EXPENSE'
      const values = expense
        ? await expenseValues(sql, expenseInput(expenseResponse(source)))
        : await incomeValues(sql, incomeInput(incomeResponse(source)))
      const display = String(expense ? values.product_name_snapshot : values.income_name)
      const now = this.clock().toISOString()
      const columns = ['id', 'entry_type', 'display_name', 'normalized_name', 'source_record_id', ...payload, 'last_used_at', 'created_at', 'updated_at']
      const args = [crypto.randomUUID(), String(source.entry_type), display, normalizedDictionaryName(display), sourceId,
        ...payload.map(field => values[field] ?? null), now, now, now]
      const update = ['display_name', 'source_record_id', ...payload, 'last_used_at', 'updated_at']
      await sql.run(`INSERT INTO daily_entry_template(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})
        ON CONFLICT(entry_type,normalized_name) DO UPDATE SET ${update.map(field => `${field}=excluded.${field}`).join(',')},row_version=row_version+1`, args)
      return this.summary((await sql.query(`${projection} WHERE entry_type=? AND normalized_name=?`, [String(source.entry_type), normalizedDictionaryName(display)]))[0]!)
    })
  }

  select(datasetId: string, id: string): Promise<DailyTemplateSelection> {
    requireId(id)
    return this.database.write(async sql => {
      await assertDataset(sql, datasetId)
      const row = (await sql.query(`${projection} WHERE id=?`, [id]))[0]
      if (!row) {
        throw new LocalError('DAILY_TEMPLATE_NOT_FOUND', '日常模板不存在。')
      }
      const expense = row.entry_type === 'EXPENSE'
      const unavailable: DailyTemplateSelection['unavailableFields'] = []
      const result: DailyTemplateSelection = { id, entryType: expense ? 'EXPENSE' : 'INCOME', displayName: String(row.display_name), unavailableFields: unavailable }
      const references = [
        ['fundingChannelId', 'funding_channel', 'FUNDING_CHANNEL'],
        ...(expense ? [['productId', 'product', 'PRODUCT'], ['primaryCategoryId', 'primary_category', 'EXPENSE_CATEGORY'],
          ['secondaryCategoryId', 'secondary_category', 'EXPENSE_CATEGORY'], ['unitId', 'unit', 'UNIT'],
          ['purchaseChannelId', 'purchase_channel', 'PURCHASE_CHANNEL'], ['locationLabelId', 'location_label', 'LOCATION_LABEL']]
          : [['payerId', 'payer', 'PAYER'], ['incomeCategoryId', 'income_category', 'INCOME_CATEGORY']]),
      ]
      const names: Record<string, string> = { productId: 'productName', primaryCategoryId: 'primaryCategoryName', secondaryCategoryId: 'secondaryCategoryName',
        unitId: 'unitName', fundingChannelId: 'fundingChannelName', purchaseChannelId: 'purchaseChannelName', locationLabelId: 'locationLabelName',
        payerId: 'payerName', incomeCategoryId: 'incomeCategoryName' }
      const selected = result as unknown as Record<string, unknown>
      for (const [field, column, kind] of references) {
        const reference = row[`${column}_id`]
        if (reference == null) {
          continue
        }
        const active = (await sql.query(`SELECT d.id,d.name,d.parent_id FROM dictionary_item d
          WHERE d.id=? AND d.kind=? AND d.status='ACTIVE'
          AND NOT EXISTS(SELECT 1 FROM product_details p WHERE p.product_id=d.id AND p.merged_into_id IS NOT NULL)`, [String(reference), kind]))[0]
        const hierarchy = field === 'primaryCategoryId' ? active?.parent_id === null
          : field === 'secondaryCategoryId' ? Boolean(result.primaryCategoryId) && active?.parent_id === result.primaryCategoryId : true
        if (!active || !hierarchy) {
          unavailable.push(field as typeof unavailable[number])
        } else {
          selected[field] = String(active.id)
          selected[names[field]!] = String(active.name)
        }
      }
      if (expense) {
        result.unitPrice = scaledIntegerToDecimal(fromSqliteInteger(row.price_text), 4)
        result.quantity = scaledIntegerToDecimal(fromSqliteInteger(row.quantity_text), 3)
        result.paidAmount = scaledIntegerToDecimal(fromSqliteInteger(row.amount_text), 2)
      } else {
        result.incomeName = String(row.income_name ?? row.display_name)
        result.incomeAmount = scaledIntegerToDecimal(fromSqliteInteger(row.amount_text), 2)
      }
      const now = this.clock().toISOString()
      await sql.run('UPDATE daily_entry_template SET last_used_at=?,updated_at=?,row_version=row_version+1 WHERE id=?', [now, now, id])
      return result
    })
  }

  remove(datasetId: string, id: string) {
    requireId(id)
    return this.database.write(async sql => {
      await assertDataset(sql, datasetId)
      // 重复移除安全；不改变来源账目、回执或最近值。
      await sql.run('DELETE FROM daily_entry_template WHERE id=?', [id])
    })
  }

  private summary(row: Record<string, unknown>): DailyTemplateSummary {
    return { id: String(row.id), entryType: row.entry_type as DailyTemplateEntryType, displayName: String(row.display_name),
      amount: scaledIntegerToDecimal(fromSqliteInteger(row.amount_text), 2),
      contextName: String(row.entry_type === 'EXPENSE' ? row.primary_category_name_snapshot : row.payer_name_snapshot), lastUsedAt: String(row.last_used_at) }
  }
}
