import type { LedgerDatabase, SqlSession } from '../ledgerDatabase'
import type { CreateExpenseRequest, CreateIncomeRequest, EntryType, UpdateExpenseRequest, UpdateIncomeRequest } from './types'
import { sha256 } from '../migrations'
import { LocalError } from '../../domain/localError'
import { requireId, validateQuery } from '../dictionaries/repository'
import { expectedVersion, expenseInput, incomeInput, operationId, validateWriteTime } from './writePolicy'
import { expenseResponse, expenseValues, incomeResponse, incomeValues, readEntry, refreshRecent, storeEntry, versionConflict } from './repository'

/** 字段、引用、版本、最近值和操作回执由同一事务维护；页面不直接拼接写入步骤。 */
export class EntryService {
  constructor(private readonly database: Pick<LedgerDatabase, 'read' | 'executeOnce'>, private readonly clock = () => new Date()) {}

  createExpense(request: CreateExpenseRequest, key: string) {
    const now = this.clock()
    return this.save('EXPENSE', expenseInput(request), key, now, expenseValues, expenseResponse)
  }

  updateExpense(id: string, request: UpdateExpenseRequest, key: string) {
    const now = this.clock()
    return this.save('EXPENSE', expenseInput(request.entry), key, now, expenseValues, expenseResponse, id, expectedVersion(request.version))
  }

  createIncome(request: CreateIncomeRequest, key: string) {
    const now = this.clock()
    return this.save('INCOME', incomeInput(request), key, now, incomeValues, incomeResponse)
  }

  updateIncome(id: string, request: UpdateIncomeRequest, key: string) {
    const now = this.clock()
    return this.save('INCOME', incomeInput(request.entry), key, now, incomeValues, incomeResponse, id, expectedVersion(request.version))
  }

  getExpense(id: string, signal?: AbortSignal) {
    requireId(id)
    return this.database.read(async sql => expenseResponse(await readEntry(sql, id, 'EXPENSE')), signal)
  }

  getIncome(id: string, signal?: AbortSignal) {
    requireId(id)
    return this.database.read(async sql => incomeResponse(await readEntry(sql, id, 'INCOME')), signal)
  }

  recentIncomeNames(query = '', signal?: AbortSignal) {
    const normalized = validateQuery(query)
    return this.database.read(async sql => {
      const rows = await sql.query(`SELECT income_name FROM ledger_entry WHERE entry_type='INCOME' AND lifecycle_status='ACTIVE'
        AND income_name IS NOT NULL AND (?='' OR instr(normalized_income_name,?)>0)
        GROUP BY normalized_income_name ORDER BY MAX(created_at) DESC,normalized_income_name LIMIT 20`, [normalized, normalized])
      return { items: rows.map(row => String(row.income_name)) }
    }, signal)
  }

  async undo(type: EntryType, id: string, requestedKey: string): Promise<void> {
    requireId(id)
    const key = operationId(requestedKey)
    const operation = type.toLowerCase()
    const digest = await sha256(JSON.stringify({ id, key }))
    await this.database.executeOnce(`${operation}.undo`, key, digest, async sql => {
      const receipt = (await sql.query('SELECT result_json FROM idempotency_result WHERE operation=? AND operation_id=?', [`${operation}.create`, key]))[0]
      const original = receipt ? JSON.parse(String(receipt.result_json)) : undefined
      const row = await readEntry(sql, id, type)
      const linked = await sql.query('SELECT id FROM daily_entry_template WHERE source_record_id=? LIMIT 1', [id])
      if (original?.id !== id || row.row_version !== 1 || linked.length || this.clock().getTime() - new Date(String(row.created_at)).getTime() > 86_400_000) {
        throw new LocalError(`${type}_NOT_UNDOABLE`, '该账目已修改、超过撤销时限或已有后续关联，无法撤销本次保存。')
      }
      await sql.run('DELETE FROM ledger_entry WHERE id=? AND row_version=1', [id])
      await refreshRecent(sql, type, String(type === 'EXPENSE' ? row.product_id : row.payer_id), this.clock().toISOString())
      // 创建回执永久保留：撤销后重试同一创建不会再次插入账目；撤销本身也可安全重试。
      return { id }
    })
  }

  private async save<I extends { occurredAt: string }, R extends { id: string; version: number }>(type: EntryType, input: I, requestedKey: string, now: Date,
    valuesFor: (sql: SqlSession, input: I) => Promise<Record<string, string | number | null>>,
    project: (row: Record<string, unknown>) => R, requestedId?: string, version?: number): Promise<R> {
    const key = operationId(requestedKey)
    if (requestedId !== undefined) {
      requireId(requestedId)
    }
    const operation = `${type.toLowerCase()}.${version === undefined ? 'create' : 'update'}`
    const digest = await sha256(JSON.stringify({ id: requestedId, version, input }))
    const result = await this.database.executeOnce(operation, key, digest, async sql => {
      validateWriteTime(input.occurredAt, now)
      const id = requestedId ?? crypto.randomUUID()
      const previous = version === undefined ? undefined : await readEntry(sql, id, type)
      if (previous && previous.row_version !== version) {
        throw versionConflict()
      }
      const values = await valuesFor(sql, input)
      await storeEntry(sql, id, type, values, now.toISOString(), version)
      if (version === undefined) {
        // 正式保存与消费对应草稿同事务，提交后未收到确认/进程退出也不会恢复已入账草稿。
        await sql.run('DELETE FROM ledger_draft WHERE dataset_id=(SELECT dataset_id FROM ledger_meta) AND entry_type=?', [type])
      }
      const reference = type === 'EXPENSE' ? 'product_id' : 'payer_id'
      await refreshRecent(sql, type, String(values[reference]), now.toISOString(), id)
      if (previous && previous[reference] !== values[reference]) {
        await refreshRecent(sql, type, String(previous[reference]), now.toISOString())
      }
      return project(await readEntry(sql, id, type))
    }, undefined, async (sql, saved) => {
      if (version === undefined) {
        const undone = await sql.query('SELECT operation_id FROM idempotency_result WHERE operation=? AND operation_id=?', [`${type.toLowerCase()}.undo`, key])
        if (undone.length) {
          throw new LocalError('LEDGER_ENTRY_UNDONE', '本次保存已撤销，请重新填写并保存。')
        }
      } else {
        // 原回执保留不变；账目后续已修改时不能把旧 DTO 当作当前保存成功。
        const current = await readEntry(sql, saved.id, type)
        if (current.row_version !== saved.version) {
          throw versionConflict()
        }
      }
    })
    return result
  }
}
