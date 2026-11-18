import type { LedgerDatabase, SqlSession } from '../ledgerDatabase'
import { assertDataset } from '../personal/datasetScope'
import { LocalError, throwIfCancelled } from '../../domain/localError'
import { retention } from './lifecycleService'
import { refreshRecent } from './repository'

export interface ClockSample { wall: number; monotonic: number; session: string }
export interface CleanupResult {
  status: 'running' | 'success' | 'deferred' | 'failed' | 'cancelled'
  reason?: string; deleted: number; batches: number; more: boolean; lastId?: string; previousOutcome?: string
}
/** 阶段 0 冻结的可观测时钟保护，不使用联网校时；每个前台轮次只判定一次。 */
export function clockDeferral(previous: ClockSample | undefined, current: ClockSample): string | undefined {
  if (!Number.isFinite(current.wall) || !Number.isFinite(current.monotonic)) return '设备时钟不可用'
  if (!previous || !Number.isFinite(previous.wall) || !Number.isFinite(previous.monotonic) || typeof previous.session !== 'string') return '尚无时钟观测基线'
  const elapsed = current.wall - previous.wall
  if (elapsed < -300_000) return '设备时间回退超过 5 分钟'
  if (previous.session === current.session && Math.abs(elapsed - (current.monotonic - previous.monotonic)) > 300_000) return '设备墙钟与单调时钟不一致'
  if (previous.session !== current.session && elapsed >= retention) return '跨启动间隔达到 30 天，需重新建立观测'
}

/** 最多 5 批、每批总删除行数最多 100；先清子项再清无关联的来源，不留下孤儿。 */
export class CleanupService {
  private running?: { dataset: string; promise: Promise<CleanupResult> }
  constructor(private readonly database: Pick<LedgerDatabase, 'read' | 'write'>,
    private readonly sample: () => ClockSample,
    private readonly afterBatch: (result: CleanupResult) => Promise<void> = async () => {}) {}

  run(dataset: string, signal?: AbortSignal): Promise<CleanupResult> {
    if (this.running) return this.running.dataset === dataset ? this.running.promise : Promise.reject(new LocalError('DATASET_CHANGED', '账本已切换，请稍后重新检查清理。'))
    const promise = this.execute(dataset, signal).finally(() => { this.running = undefined })
    this.running = { dataset, promise }
    return promise
  }
  private async execute(dataset: string, signal?: AbortSignal): Promise<CleanupResult> {
    const current = this.sample()
    let result: CleanupResult = { status: 'running', deleted: 0, batches: 0, more: false }
    try {
      throwIfCancelled(signal)
      await this.database.write(async sql => {
        await assertDataset(sql, dataset)
        const rows = await sql.query("SELECT key,value FROM maintenance_state WHERE key IN ('clock','cleanup')")
        const saved = Object.fromEntries(rows.map(row => [String(row.key), JSON.parse(String(row.value))]))
        const reason = clockDeferral(saved.clock, current)
        result = { ...result, ...(reason ? { status: 'deferred', reason } : {}),
          ...(saved.cleanup ? { previousOutcome: saved.cleanup.status === 'running' ? 'interrupted' : saved.cleanup.status } : {}) }
        if (Number.isFinite(current.wall) && Number.isFinite(current.monotonic)) await store(sql, 'clock', current)
        await store(sql, 'cleanup', result)
      }, signal)
      if (result.status === 'deferred') return result
      const cutoff = new Date(current.wall).toISOString()
      for (let batch = 0; batch < 5; batch++) {
        throwIfCancelled(signal)
        result = await this.database.write(async sql => {
          await assertDataset(sql, dataset)
          const adjustments = await sql.query(`SELECT a.id FROM expense_adjustment a JOIN ledger_entry l ON l.id=a.original_expense_id
            WHERE (a.status='TRASHED' AND a.purge_after<=?) OR (l.lifecycle_status='TRASHED' AND l.purge_after<=?)
            ORDER BY a.id LIMIT 100`, [cutoff, cutoff])
          for (const item of adjustments) await sql.run('DELETE FROM expense_adjustment WHERE id=?', [String(item.id)])
          const entries = await sql.query(`SELECT l.id,l.entry_type,l.product_id,l.payer_id FROM ledger_entry l
            WHERE l.lifecycle_status='TRASHED' AND l.purge_after<=? AND NOT EXISTS(SELECT 1 FROM expense_adjustment a WHERE a.original_expense_id=l.id)
            ORDER BY l.purge_after,l.id LIMIT ?`, [cutoff, 100 - adjustments.length])
          for (const item of entries) {
            await sql.run('DELETE FROM ledger_entry WHERE id=?', [String(item.id)])
            await refreshRecent(sql, item.entry_type as 'EXPENSE' | 'INCOME', String(item.entry_type === 'EXPENSE' ? item.product_id : item.payer_id), cutoff)
          }
          const count = adjustments.length + entries.length
          const more = Boolean((await sql.query(`SELECT 1 FROM ledger_entry WHERE lifecycle_status='TRASHED' AND purge_after<=?
            UNION ALL SELECT 1 FROM expense_adjustment WHERE status='TRASHED' AND purge_after<=? LIMIT 1`, [cutoff, cutoff])).length)
          const next = { ...result, deleted: result.deleted + count, batches: result.batches + 1, more,
            lastId: String(entries.at(-1)?.id ?? adjustments.at(-1)?.id ?? result.lastId ?? '') }
          await store(sql, 'cleanup', next)
          return next
        }, signal)
        await this.afterBatch({ ...result })
        if (!result.more) break
      }
      result = { ...result, status: 'success' }
    } catch (cause) {
      result = { ...result, status: signal?.aborted ? 'cancelled' : 'failed', reason: signal?.aborted ? '本轮清理已取消，后续前台继续检查' : '本轮清理未完成，原数据已保留，后续前台继续检查' }
      // 失败不在本轮重试；原子批次外仍尽力保存最小状态，不能让诊断写入掩盖原故障。
      try { await this.finish(dataset, result) } catch { /* 存储不可写时由运行期状态保留失败提示。 */ }
      if (cause instanceof LocalError && cause.code === 'DATASET_CHANGED') throw cause
      return result
    }
    await this.finish(dataset, result)
    return result
  }
  private finish(dataset: string, result: CleanupResult) {
    return this.database.write(async sql => { await assertDataset(sql, dataset); await store(sql, 'cleanup', result) })
  }
}
async function store(sql: SqlSession, key: string, value: unknown) {
  await sql.run('INSERT INTO maintenance_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, JSON.stringify(value)])
}
