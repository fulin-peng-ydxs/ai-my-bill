import type { LedgerDatabase, SqlSession } from '../ledgerDatabase'
import type { CreateExpenseAdjustmentRequest, ExpenseAdjustmentResponse } from '../../api/expenseAdjustments'
import { sha256 } from '../migrations'
import { LocalError } from '../../domain/localError'
import { decimalToScaledInteger, fromSqliteInteger, MONEY_MAX, scaledIntegerToDecimal, toSqliteInteger } from '../../domain/money'
import { fieldError, requireId } from '../dictionaries/repository'
import { decimal, expectedVersion, occurredAt, operationId, text, validateWriteTime } from './writePolicy'
import { readEntry } from './repository'
import { assertDataset } from '../personal/datasetScope'

export const money = (value: unknown) => scaledIntegerToDecimal(fromSqliteInteger(value), 2)
export const effectiveTotal = async (sql: SqlSession, source: string) => fromSqliteInteger((await sql.query(
  "SELECT CAST(COALESCE(SUM(amount_cents),0) AS TEXT) AS total FROM expense_adjustment WHERE original_expense_id=? AND status='EFFECTIVE'", [source]))[0]!.total)

/** 调整与来源共用同一事务队列；只在创建时校验时间，回执重试不重复计入净支出。 */
export class AdjustmentService {
  constructor(private readonly database: Pick<LedgerDatabase, 'read' | 'executeOnce'>, private readonly clock = () => new Date()) {}

  create(dataset: string, source: string, request: CreateExpenseAdjustmentRequest, requestedKey: string) {
    requireId(source)
    if (!['REFUND', 'REIMBURSEMENT'].includes(request.adjustmentType)) throw fieldError('adjustmentType', '请选择退款或报销。')
    const input = { adjustmentType: request.adjustmentType, amount: decimal('amount', request.amount, 2, MONEY_MAX, true),
      ...occurredAt(request.occurredAt), note: text('note', request.note, 500) }
    const key = operationId(requestedKey)
    return this.perform(dataset, 'adjustment.create', key, { source, input }, async sql => {
      const now = this.clock()
      validateWriteTime(input.occurredAt, now)
      const row = await readEntry(sql, source, 'EXPENSE')
      const amount = decimalToScaledInteger(input.amount, 2)
      if (await effectiveTotal(sql, source) + amount > fromSqliteInteger(row.amount_text)) {
        throw new LocalError('ADJUSTMENT_EXCEEDS_EXPENSE', '调整累计金额不能超过原支出实付金额。', {
          fieldErrors: [{ field: 'amount', message: '调整累计金额不能超过原支出实付金额。' }],
        })
      }
      const id = crypto.randomUUID()
      await sql.run(`INSERT INTO expense_adjustment(id,original_expense_id,adjustment_type,amount_cents,business_time,business_date,note,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, [id, source, input.adjustmentType, toSqliteInteger(amount), input.occurredAt, input.businessDate, input.note ?? null, now.toISOString(), now.toISOString()])
      return this.response(sql, id)
    })
  }

  get(dataset: string, id: string, signal?: AbortSignal) {
    requireId(id)
    return this.database.read(async sql => { await assertDataset(sql, dataset); return this.response(sql, id) }, signal)
  }

  revoke(dataset: string, id: string, version: number, requestedKey: string) {
    requireId(id)
    expectedVersion(version)
    return this.perform(dataset, 'adjustment.revoke', operationId(requestedKey), { id, version }, async sql => {
      const row = await this.response(sql, id)
      if (row.status !== 'EFFECTIVE' || row.version !== version) throw new LocalError('ADJUSTMENT_CHANGED', '调整状态已变化，请刷新后重试。')
      await sql.run("UPDATE expense_adjustment SET status='REVOKED',row_version=row_version+1,updated_at=? WHERE id=? AND row_version=?", [this.clock().toISOString(), id, version])
      return this.response(sql, id)
    })
  }

  private async perform(dataset: string, operation: string, key: string, input: unknown, work: (sql: SqlSession) => Promise<ExpenseAdjustmentResponse>) {
    const digest = await sha256(JSON.stringify({ dataset, input }))
    let response!: ExpenseAdjustmentResponse
    await this.database.executeOnce(operation, key, digest, async sql => { await assertDataset(sql, dataset); return work(sql) }, undefined,
      async (sql, saved) => {
        await assertDataset(sql, dataset)
        const current = await this.response(sql, saved.id)
        if (current.version !== saved.version || current.status !== saved.status) throw new LocalError('ADJUSTMENT_CHANGED', '调整已有后续变化，请刷新后重试。')
        response = current
      })
    return response
  }

  private async response(sql: SqlSession, id: string): Promise<ExpenseAdjustmentResponse> {
    const row = (await sql.query(`SELECT a.*,l.product_name_snapshot,CAST(a.amount_cents AS TEXT) AS amount_text,
      CAST(l.amount_cents AS TEXT) AS paid_text FROM expense_adjustment a JOIN ledger_entry l ON l.id=a.original_expense_id WHERE a.id=?`, [id]))[0]
    if (!row) throw new LocalError('ADJUSTMENT_NOT_FOUND', '调整不存在或已被永久删除。')
    const total = await effectiveTotal(sql, String(row.original_expense_id))
    const paid = fromSqliteInteger(row.paid_text)
    return { id, originalExpenseId: String(row.original_expense_id), originalExpenseTitle: String(row.product_name_snapshot),
      adjustmentType: row.adjustment_type as ExpenseAdjustmentResponse['adjustmentType'], amount: money(row.amount_text),
      occurredAt: String(row.business_time), businessDate: String(row.business_date), status: row.status as ExpenseAdjustmentResponse['status'],
      ...(row.note == null ? {} : { note: String(row.note) }), originalPaidAmount: money(row.paid_text),
      effectiveAdjustmentAmount: scaledIntegerToDecimal(total, 2), netExpenseAmount: scaledIntegerToDecimal(paid - total, 2), fullyAdjusted: total > 0n && total === paid,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), version: Number(row.row_version) }
  }
}
