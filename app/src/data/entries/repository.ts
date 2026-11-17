import type { SqlSession } from '../ledgerDatabase'
import type { DictionaryType } from '../dictionaries/types'
import type { EntryType, ExpenseResponse, IncomeResponse } from './types'
import type { expenseInput, incomeInput } from './writePolicy'
import { fieldError, requireDictionary } from '../dictionaries/repository'
import { LocalError } from '../../domain/localError'
import { decimalToScaledInteger, fromSqliteInteger, scaledIntegerToDecimal, toSqliteInteger } from '../../domain/money'

type Values = Record<string, string | number | null>
export const entryProjection = `SELECT l.*, CAST(amount_cents AS TEXT) AS amount_text,
  CAST(unit_price_scaled AS TEXT) AS price_text, CAST(quantity_scaled AS TEXT) AS quantity_text,
  CAST(calculated_amount_cents AS TEXT) AS calculated_text FROM ledger_entry l`

export function versionConflict(): LocalError {
  return new LocalError('LEDGER_VERSION_CONFLICT', '账目已发生变化，请加载最新内容或重新确认本次修改。')
}

export async function readEntry(sql: SqlSession, id: string, type: EntryType) {
  const row = (await sql.query(`${entryProjection} WHERE id=? AND entry_type=? AND lifecycle_status='ACTIVE'`, [id, type]))[0]
  if (!row) {
    throw new LocalError('LEDGER_ENTRY_NOT_FOUND', '账目不存在或已不在有效账目中。')
  }
  return row
}

function common(row: Record<string, unknown>) {
  return {
    id: String(row.id), occurredAt: String(row.business_time), businessDate: String(row.business_date),
    fundingChannelId: String(row.funding_channel_id), fundingChannelName: String(row.funding_channel_name_snapshot),
    ...(row.note == null ? {} : { note: String(row.note) }),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at ?? row.created_at), version: Number(row.row_version),
  }
}

function optionalText(value: unknown): string | undefined {
  return value == null ? undefined : String(value)
}

export function expenseResponse(row: Record<string, unknown>): ExpenseResponse {
  if (row.price_text == null || row.quantity_text == null || row.calculated_text == null) {
    throw new LocalError('LEDGER_ENTRY_INCOMPATIBLE', '该历史记录缺少完整量价，无法编辑。')
  }
  return {
    ...common(row), productId: String(row.product_id), productName: String(row.product_name_snapshot),
    primaryCategoryId: String(row.primary_category_id), primaryCategoryName: String(row.primary_category_name_snapshot),
    secondaryCategoryId: optionalText(row.secondary_category_id), secondaryCategoryName: optionalText(row.secondary_category_name_snapshot),
    unitId: String(row.unit_id), unitName: String(row.unit_name_snapshot),
    unitPrice: scaledIntegerToDecimal(fromSqliteInteger(row.price_text), 4),
    quantity: scaledIntegerToDecimal(fromSqliteInteger(row.quantity_text), 3),
    calculatedAmount: scaledIntegerToDecimal(fromSqliteInteger(row.calculated_text), 2),
    paidAmount: scaledIntegerToDecimal(fromSqliteInteger(row.amount_text), 2), effectiveAdjustmentAmount: '0.00',
    purchaseChannelId: optionalText(row.purchase_channel_id), purchaseChannelName: optionalText(row.purchase_channel_name_snapshot),
    locationLabelId: optionalText(row.location_label_id), locationLabelName: optionalText(row.location_label_name_snapshot),
  }
}

export function incomeResponse(row: Record<string, unknown>): IncomeResponse {
  if (row.income_name == null) {
    throw new LocalError('LEDGER_ENTRY_INCOMPATIBLE', '该历史记录缺少收入名称，无法编辑。')
  }
  return {
    ...common(row), incomeName: String(row.income_name), payerId: String(row.payer_id), payerName: String(row.payer_name_snapshot),
    incomeCategoryId: String(row.income_category_id), incomeCategoryName: String(row.income_category_name_snapshot),
    amount: scaledIntegerToDecimal(fromSqliteInteger(row.amount_text), 2),
  }
}

async function active(sql: SqlSession, type: DictionaryType, id: string, field: string, parentId?: string) {
  const row = await requireDictionary(sql, type, id).catch(error => {
    if (error instanceof LocalError && error.code === 'DICTIONARY_ITEM_NOT_FOUND') {
      throw fieldError(field, '请选择当前启用的选项。')
    }
    throw error
  })
  if (row.status !== 'ACTIVE' || type === 'expense-category' && row.parent_id !== (parentId ?? null)) {
    throw fieldError(field, '请选择当前启用且层级正确的选项。')
  }
  return row.name
}

const scaled = (value: string, scale: number) => toSqliteInteger(decimalToScaledInteger(value, scale))

export async function expenseValues(sql: SqlSession, input: ReturnType<typeof expenseInput>): Promise<Values> {
  return {
    ...baseValues(input, input.paidAmount), product_id: input.productId,
    product_name_snapshot: await active(sql, 'product', input.productId, 'productId'),
    primary_category_id: input.primaryCategoryId,
    primary_category_name_snapshot: await active(sql, 'expense-category', input.primaryCategoryId, 'primaryCategoryId'),
    secondary_category_id: input.secondaryCategoryId ?? null,
    secondary_category_name_snapshot: input.secondaryCategoryId ? await active(sql, 'expense-category', input.secondaryCategoryId, 'secondaryCategoryId', input.primaryCategoryId) : null,
    unit_id: input.unitId, unit_name_snapshot: await active(sql, 'unit', input.unitId, 'unitId'),
    funding_channel_name_snapshot: await active(sql, 'funding-channel', input.fundingChannelId, 'fundingChannelId'),
    purchase_channel_id: input.purchaseChannelId ?? null,
    purchase_channel_name_snapshot: input.purchaseChannelId ? await active(sql, 'purchase-channel', input.purchaseChannelId, 'purchaseChannelId') : null,
    location_label_id: input.locationLabelId ?? null,
    location_label_name_snapshot: input.locationLabelId ? await active(sql, 'location', input.locationLabelId, 'locationLabelId') : null,
    unit_price_scaled: scaled(input.unitPrice, 4), quantity_scaled: scaled(input.quantity, 3),
    calculated_amount_cents: scaled(input.calculatedAmount, 2),
  }
}

export async function incomeValues(sql: SqlSession, input: ReturnType<typeof incomeInput>): Promise<Values> {
  return {
    ...baseValues(input, input.amount), income_name: input.incomeName, normalized_income_name: input.normalizedIncomeName,
    payer_id: input.payerId, payer_name_snapshot: await active(sql, 'payer', input.payerId, 'payerId'),
    income_category_id: input.incomeCategoryId,
    income_category_name_snapshot: await active(sql, 'income-category', input.incomeCategoryId, 'incomeCategoryId'),
    funding_channel_name_snapshot: await active(sql, 'funding-channel', input.fundingChannelId, 'fundingChannelId'),
  }
}

function baseValues(input: { occurredAt: string; businessDate: string; fundingChannelId: string; note?: string }, amount: string): Values {
  return { amount_cents: scaled(amount, 2), business_time: input.occurredAt, business_date: input.businessDate,
    funding_channel_id: input.fundingChannelId, note: input.note ?? null }
}

/** 列名只来自上面的内部映射；调用方业务输入不参与 SQL 拼接。 */
export async function storeEntry(sql: SqlSession, id: string, type: EntryType, values: Values, now: string, version?: number) {
  const columns = Object.keys(values)
  if (version === undefined) {
    await sql.run(`INSERT INTO ledger_entry(id,entry_type,created_at,updated_at,${columns.join(',')})
      VALUES(?,?,?,?,${columns.map(() => '?').join(',')})`, [id, type, now, now, ...Object.values(values)])
  } else {
    const changed = await sql.run(`UPDATE ledger_entry SET ${columns.map(column => `${column}=?`).join(',')},
      updated_at=?,row_version=row_version+1 WHERE id=? AND entry_type=? AND row_version=? AND lifecycle_status='ACTIVE'`,
    [...Object.values(values), now, id, type, version])
    if (changed !== 1) {
      throw versionConflict()
    }
  }
}

/** 编辑换对象或撤销后，从仍有效的最近一笔回算；不留下被撤销记录的自动值。 */
export async function refreshRecent(sql: SqlSession, type: EntryType, id: string, now: string, savedId?: string) {
  if (type === 'EXPENSE') {
    const row = (await sql.query(`SELECT primary_category_id,secondary_category_id,unit_id,
      CAST(unit_price_scaled AS TEXT) AS price,CAST(quantity_scaled AS TEXT) AS quantity,
      funding_channel_id,purchase_channel_id FROM ledger_entry WHERE product_id=? AND lifecycle_status='ACTIVE'
      AND unit_price_scaled IS NOT NULL ORDER BY id=? DESC,updated_at DESC,rowid DESC LIMIT 1`, [id, savedId ?? '']))[0]
    await sql.run(`UPDATE product_details SET default_primary_category_id=?,default_secondary_category_id=?,default_unit_id=?,
      last_unit_price_scaled=?,last_quantity_scaled=?,last_funding_channel_id=?,last_purchase_channel_id=?,updated_at=? WHERE product_id=?`,
    [row?.primary_category_id as string ?? null, row?.secondary_category_id as string ?? null, row?.unit_id as string ?? null,
      row?.price as string ?? null, row?.quantity as string ?? null, row?.funding_channel_id as string ?? null,
      row?.purchase_channel_id as string ?? null, now, id])
  } else {
    const row = (await sql.query(`SELECT income_category_id,funding_channel_id FROM ledger_entry
      WHERE payer_id=? AND lifecycle_status='ACTIVE' ORDER BY id=? DESC,updated_at DESC,rowid DESC LIMIT 1`, [id, savedId ?? '']))[0]
    if (!row) {
      await sql.run('DELETE FROM payer_details WHERE payer_id=?', [id])
      return
    }
    await sql.run(`INSERT INTO payer_details VALUES(?,?,?,?) ON CONFLICT(payer_id) DO UPDATE SET
      last_income_category_id=excluded.last_income_category_id,last_funding_channel_id=excluded.last_funding_channel_id,updated_at=excluded.updated_at`,
    [id, row.income_category_id as string, row.funding_channel_id as string, now])
  }
}
