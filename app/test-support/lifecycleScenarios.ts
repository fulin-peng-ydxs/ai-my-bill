import { LedgerDatabase } from '../src/data/ledgerDatabase'
import { AdjustmentService } from '../src/data/entries/adjustmentService'
import { LifecycleService, DAY, retention } from '../src/data/entries/lifecycleService'
import { CleanupService, clockDeferral, type ClockSample, type CleanupResult } from '../src/data/entries/cleanupService'
import { EntryReadbackQuery } from '../src/data/entries/readbackQuery'
import { LocalError } from '../src/domain/localError'
import { migrations, type Migration } from '../src/data/migrations'
import { entryFixture } from './entryScenarios'

function check(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error(message)
  }
}
async function refused(task: () => Promise<unknown>, code?: string) {
  try {
    await task()
  } catch (error) {
    check(!code || error instanceof LocalError && error.code === code, `预期 ${code}，实际 ${String(error)}`)
    return
  }
  throw new Error('未拒绝不合法操作')
}
const dataset = async (db: LedgerDatabase) => String((await db.read(sql => sql.query('SELECT dataset_id FROM ledger_meta')))[0]!.dataset_id)

export async function adjustmentLifecycleScenario(db: LedgerDatabase) {
  const f = await entryFixture(db)
  const ds = await dataset(db)
  const adjustments = new AdjustmentService(db, () => f.now)
  const lifecycle = new LifecycleService(db, () => f.now)
  const expense = await f.service.createExpense(f.expense, 'source')
  const income = await f.service.createIncome(f.income, 'income')
  const input = { adjustmentType: 'REFUND' as const, amount: '3.00', occurredAt: f.now.toISOString(), note: '退款测试' }
  const refund = await adjustments.create(ds, expense.id, input, 'refund')
  const reimb = await adjustments.create(ds, expense.id, { ...input, adjustmentType: 'REIMBURSEMENT', amount: '2.00' }, 'reimb')
  check((await adjustments.create(ds, expense.id, input, 'refund')).effectiveAdjustmentAmount === '5.00', '重试 DTO 使用旧累计或重复入账')
  await refused(() => adjustments.create(ds, expense.id, { ...input, amount: '3.01' }, 'refund'), 'IDEMPOTENCY_CONFLICT')
  await refused(() => adjustments.create(ds, expense.id, { ...input, amount: '11.00' }, 'over'), 'ADJUSTMENT_EXCEEDS_EXPENSE')
  await refused(() => f.service.updateExpense(expense.id, { version: 1, entry: { ...f.expense, paidAmount: '4.00' } }, 'below'), 'VALIDATION_FAILED')
  await refused(() => f.service.undo('EXPENSE', expense.id, 'source'), 'EXPENSE_NOT_UNDOABLE')
  check((await f.service.getExpense(expense.id)).effectiveAdjustmentAmount === '5.00', '编辑详情累计错误')
  const query = new EntryReadbackQuery(db, () => f.now)
  const filters = { query: '', type: 'ALL' as const, lifecycle: 'ACTIVE' as const, range: 'TODAY' as const }
  const items = (await query.list(filters)).items
  check(items.length === 4 && items.find(i => i.id === expense.id)?.netExpenseAmount === '10.00', '明细净额或类型错误')
  check((await query.list({ ...filters, type: 'INCOME' })).items.length === 1, '调整计入收入')
  await adjustments.revoke(ds, refund.id, 1, 'revoke')
  await adjustments.revoke(ds, refund.id, 1, 'revoke')
  check((await adjustments.get(ds, reimb.id)).effectiveAdjustmentAmount === '2.00', '撤销未退出累计')
  const trashed = await lifecycle.change(ds, { id: reimb.id, entryType: 'ADJUSTMENT', version: 1 }, 'trash', 'trash-a')
  check(trashed?.version === 2 && (await f.service.getExpense(expense.id)).effectiveAdjustmentAmount === '0.00', '删除调整未退出累计')
  await lifecycle.change(ds, { id: reimb.id, entryType: 'ADJUSTMENT', version: 2 }, 'restore', 'restore-a')
  const deleted = await lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 1 }, 'trash', 'trash-e')
  check(deleted?.linkedAdjustmentCount === 2 && (await adjustments.get(ds, reimb.id)).status === 'SOURCE_FROZEN', '来源删除没有冻结调整')
  check((await query.list(filters)).items.every(i => i.id !== expense.id && i.id !== reimb.id), '冻结仍参与有效明细')
  await refused(() => adjustments.create(ds, expense.id, input, 'invalid-source'), 'LEDGER_ENTRY_NOT_FOUND')
  const restored = await lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 2 }, 'restore', 'restore-e')
  check(restored?.version === 3 && (await adjustments.get(ds, reimb.id)).status === 'EFFECTIVE', '来源恢复没有解冻')
  check((await adjustments.get(ds, refund.id)).status === 'REVOKED', '恢复来源复活已撤销调整')
  await refused(() => lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 1 }, 'trash', 'trash-e'), 'LEDGER_LIFECYCLE_CONFLICT')
  await lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 3 }, 'trash', 'trash-e-again')
  await refused(() => lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 4 }, 'purge', 'purge-alone'), 'LEDGER_HAS_ADJUSTMENTS')
  await lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 4 }, 'purge', 'purge-together', true)
  await lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 4 }, 'purge', 'purge-together', true)
  check((await db.read(sql => sql.query('SELECT id FROM expense_adjustment'))).length === 0, '永久删除留下调整')
  check((await f.service.getIncome(income.id)).amount === '1000.00', '生命周期改变无关收入')
  check((await db.read(sql => sql.query('PRAGMA foreign_key_check'))).length === 0, '存在孤儿')
  const zero = await f.service.createExpense({ ...f.expense, paidAmount: '3.00' }, 'zero-paid')
  const voided = await adjustments.create(ds, zero.id, { ...input, amount: '1.00' }, 'voided')
  await adjustments.revoke(ds, voided.id, 1, 'voided-revoke')
  await f.service.updateExpense(zero.id, { version: 1, entry: { ...f.expense, paidAmount: '0.00' } }, 'zero-edit')
  check(!(await adjustments.get(ds, voided.id)).fullyAdjusted, '零实付且没有有效调整被标为全额退款')
  return 'adjustment-cap-replay-revoke-freeze-restore-and-explicit-linked-purge'
}

export async function lifecycleFailureScenario(db: LedgerDatabase) {
  const f = await entryFixture(db)
  const ds = await dataset(db)
  const expense = await f.service.createExpense(f.expense, 'source')
  const service = new AdjustmentService(db, () => f.now)
  const lifecycle = new LifecycleService(db, () => f.now)
  const input = { adjustmentType: 'REFUND' as const, amount: '10.00', occurredAt: f.now.toISOString() }
  const writes = await Promise.allSettled([service.create(ds, expense.id, input, 'a'), service.create(ds, expense.id, input, 'b')])
  check(writes.filter(r => r.status === 'fulfilled').length === 1, '快速重复调整越过累计上限')
  await db.write(sql => sql.run("CREATE TEMP TRIGGER fail_lifecycle_receipt BEFORE INSERT ON idempotency_result BEGIN SELECT RAISE(ABORT,'controlled-receipt'); END"))
  await refused(() => lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 1 }, 'trash', 'rollback'))
  check((await f.service.getExpense(expense.id)).version === 1, '最终回执失败没有回滚来源')
  const adjustment = (await db.read(sql => sql.query('SELECT id,status,row_version FROM expense_adjustment')))[0]!
  check(adjustment.status === 'EFFECTIVE' && adjustment.row_version === 1, '最终回执失败没有回滚冻结')
  await db.write(sql => sql.run('DROP TRIGGER temp.fail_lifecycle_receipt'))
  await lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 1 }, 'trash', 'rollback')
  await db.write(sql => sql.run('UPDATE ledger_entry SET amount_cents=900 WHERE id=?', [expense.id]))
  await refused(() => lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 2 }, 'restore', 'invalid-restore'), 'LEDGER_LIFECYCLE_CONFLICT')
  await db.write(sql => sql.run('UPDATE ledger_entry SET amount_cents=1500 WHERE id=?', [expense.id]))
  await lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 2 }, 'restore', 'invalid-restore')
  await refused(() => service.revoke(ds, String(adjustment.id), 1, 'stale-revoke'), 'ADJUSTMENT_CHANGED')
  const expired = new LifecycleService(db, () => new Date(f.now.getTime() + retention))
  await lifecycle.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 3 }, 'trash', 'expired')
  await refused(() => expired.change(ds, { id: expense.id, entryType: 'EXPENSE', version: 4 }, 'restore', 'too-late'), 'LEDGER_LIFECYCLE_CONFLICT')
  await db.close()
  await db.open()
  check((await db.read(sql => sql.query('SELECT lifecycle_status FROM ledger_entry WHERE id=?', [expense.id])))[0]?.lifecycle_status === 'TRASHED', '重开丢失生命周期')
  return 'concurrent-cap-stale-version-receipt-rollback-restore-conflict-and-30-day-boundary'
}

export async function cleanupScenario(db: LedgerDatabase) {
  const f = await entryFixture(db)
  const ds = await dataset(db)
  const source = await f.service.createIncome(f.income, 'income')
  const now = f.now.getTime()
  let sample: ClockSample = { wall: now, monotonic: 1000, session: 'first' }
  const controller = new AbortController()
  const observations: number[] = []
  const service = new CleanupService(db, () => sample, async result => {
    observations.push(result.deleted)
    if (result.batches === 1) {
      controller.abort()
    }
  })
  check((await service.run(ds)).status === 'deferred', '无基线没有延期')
  await db.write(async sql => {
    for (let i = 0; i < 205; i++) {
      await sql.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,lifecycle_status,deleted_at,purge_after)
      SELECT ?,'INCOME',100,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,'TRASHED',?,? FROM ledger_entry WHERE id=?`, [`due-${i}`, new Date(now - retention).toISOString(), new Date(now).toISOString(), source.id])
    }
    await sql.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,lifecycle_status,deleted_at,purge_after)
      SELECT 'not-yet','INCOME',100,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,'TRASHED',?,? FROM ledger_entry WHERE id=?`, [new Date(now - retention + 1).toISOString(), new Date(now + 1).toISOString(), source.id])
  })
  const cancelled = await service.run(ds, controller.signal)
  check(cancelled.status === 'cancelled' && cancelled.deleted === 100 && observations[0] === 100, '取消没有在有界批次停止')
  const restarted = new CleanupService(db, () => ({ ...sample, session: 'second' }))
  const result = await restarted.run(ds)
  check(result.status === 'success' && result.deleted === 105 && result.batches === 2, '中断后重启丢失/重复清理')
  check((await db.read(sql => sql.query('SELECT count(*) AS n FROM ledger_entry')))[0]?.n === 2, '清理扩大到未到期或有效记录')
  sample = { wall: now - 300_001, monotonic: 1001, session: 'second' }
  check((await restarted.run(ds)).deleted === 0, '同一时间重复执行不幂等')
  check(clockDeferral({ wall: now, monotonic: 1, session: 'x' }, sample), '时间回退未延期')
  check(clockDeferral({ wall: now, monotonic: 1, session: 'second' }, { ...sample, wall: now + 301_002 }), '墙钟跳变未延期')
  check(clockDeferral({ wall: now - 30 * DAY, monotonic: 1, session: 'old' }, { ...sample, wall: now }), '跨启动长间隔未延期')
  await db.write(sql => sql.run("UPDATE maintenance_state SET value=? WHERE key='cleanup'", [JSON.stringify({ status: 'running' })]))
  const resumed = await new CleanupService(db, () => ({ wall: now, monotonic: 1, session: 'third' })).run(ds)
  check(resumed.previousOutcome === 'interrupted', '遗留进行中状态未识别中断')
  return 'clock-baseline-boundary-100-row-batches-cancel-restart-and-interrupted-state'
}

export async function lifecycleUpgradeScenario(manager: (suffix: string, chain?: readonly Migration[]) => LedgerDatabase) {
  const old = manager('old', migrations.slice(0, 5))
  const current = manager('old')
  const failed = manager('old', [...migrations.slice(0, 5), { ...migrations[5]!, sql: migrations[5]!.sql + '\nINSERT INTO controlled_missing_table VALUES(1);' }])
  try {
    await old.open()
    const id = await dataset(old)
    await old.write(async sql => {
      await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
      await sql.run('INSERT INTO ledger_draft VALUES(?,?,1,?,?,?)', [id, 'INCOME', '{"amount":"88"}', '2026-11-17', '2026-11-17'])
    })
    await old.close()
    await refused(() => failed.open())
    await old.open()
    check((await old.read(sql => sql.query('SELECT schema_version FROM ledger_meta')))[0]?.schema_version === 5, '失败升级推进版本')
    check(!(await old.read(sql => sql.query("SELECT name FROM sqlite_master WHERE name='expense_adjustment'"))).length, '失败升级留下部分表')
    await old.close()
    await current.open()
    check(await dataset(current) === id, '升级改变数据集')
    check((await current.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0]?.value === '"DARK"', '升级重置偏好')
    check((await current.read(sql => sql.query('SELECT data_json FROM ledger_draft')))[0]?.data_json === '{"amount":"88"}', '升级覆盖草稿')
    await adjustmentLifecycleScenario(current)
    return 'v5-v6-atomic-upgrade-user-values-and-new-lifecycle'
  } finally {
    await old.close()
    await current.close()
    await failed.close()
  }
}

export async function cleanupProtectionScenario(db: LedgerDatabase) {
  const f = await entryFixture(db)
  const ds = await dataset(db)
  const expense = await f.service.createExpense(f.expense, 'parent')
  const income = await f.service.createIncome(f.income, 'safe-income')
  const now = f.now.getTime()
  const service = new CleanupService(db, () => ({ wall: now, monotonic: 1, session: 'cleanup' }), async () => {
    check(!(await db.read(sql => sql.query('PRAGMA foreign_key_check'))).length, '批次间产生孤儿')
  })
  await service.run(ds)
  await new LifecycleService(db, () => new Date(now - retention)).change(ds, { id: expense.id, entryType: 'EXPENSE', version: 1 }, 'trash', 'old-parent')
  await db.write(async sql => {
    for (let i = 0; i < 205; i++) {
      await sql.run(`INSERT INTO expense_adjustment(id,original_expense_id,adjustment_type,amount_cents,business_time,business_date,status,created_at,updated_at)
      VALUES(?,?,'REFUND',1,?,'2026-11-17','SOURCE_FROZEN',?,?)`, [`child-${i}`, expense.id, f.now.toISOString(), f.now.toISOString(), f.now.toISOString()])
    }
  })
  const linked = await service.run(ds)
  check(linked.deleted === 206 && linked.batches === 3, '关联清理没有按总行数分批')
  await db.write(async sql => {
    for (let i = 0; i < 700; i++) {
      await sql.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,lifecycle_status,deleted_at,purge_after)
      SELECT ?,'INCOME',100,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,'TRASHED',?,? FROM ledger_entry WHERE id=?`, [`bulk-${String(i).padStart(4, '0')}`, new Date(now - retention).toISOString(), f.now.toISOString(), income.id])
    }
    await sql.run("CREATE TEMP TRIGGER fail_cleanup BEFORE DELETE ON ledger_entry WHEN OLD.id='bulk-0110' BEGIN SELECT RAISE(ABORT,'controlled-batch-failure'); END")
  })
  const failed = await service.run(ds)
  check(failed.status === 'failed' && failed.deleted === 100, '批次故障没有回滚本批或错误计入进度')
  check(failed.reason?.includes('已永久清理 100 条') && !failed.reason.includes('原数据已保留'), '部分失败提示隐瞒已提交删除')
  check(failed.error?.cause instanceof Error, '批次故障原因链丢失')
  check((await db.read(sql => sql.query("SELECT count(*) AS n FROM ledger_entry WHERE id LIKE 'bulk-%'")))[0]?.n === 600, '失败批次留下部分删除')
  await db.write(sql => sql.run('DROP TRIGGER temp.fail_cleanup'))
  const bounded = await service.run(ds)
  check(bounded.deleted === 500 && bounded.more && bounded.batches === 5, '前台轮次没有五批上限')
  check((await service.run(ds)).deleted === 100, '后续前台轮次未继续处理剩余对象')
  await refused(() => service.run('another-dataset'), 'DATASET_CHANGED')
  return 'linked-row-budget-atomic-batch-failure-five-batch-cap-and-dataset-scope'
}

/** 状态写失败不回滚已提交删除，也不能阻止调用边界广播刷新；故障原因仅留在内存。 */
export async function cleanupFinalizationScenario(db: LedgerDatabase,
  operate: (operation: () => Promise<CleanupResult>) => Promise<CleanupResult> = operation => operation()) {
  const f = await entryFixture(db)
  const ds = await dataset(db)
  const source = await f.service.createIncome(f.income, 'safe-income')
  const now = f.now.getTime()
  const service = new CleanupService(db, () => ({ wall: now, monotonic: 1, session: 'finalization' }))
  await service.run(ds)
  const due = async (id: string) => db.write(sql => sql.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,
    business_time,business_date,lifecycle_status,deleted_at,purge_after)
    SELECT ?,'INCOME',100,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,'TRASHED',?,? FROM ledger_entry WHERE id=?`,
  [id, new Date(now - retention).toISOString(), f.now.toISOString(), source.id]))
  await due('final-status-due')
  await db.write(sql => sql.run(`CREATE TEMP TRIGGER fail_final_status BEFORE INSERT ON maintenance_state
    WHEN NEW.key='cleanup' AND json_extract(NEW.value,'$.status')='success'
    BEGIN SELECT RAISE(ABORT,'controlled-final-status'); END`))
  const failed = await operate(() => service.run(ds))
  check(failed.status === 'failed' && failed.deleted === 1 && !failed.more, '最终状态写失败丢失已提交结果')
  check(failed.reason?.includes('已永久清理 1 条') && failed.reason.includes('状态保存失败'), '最终状态失败提示未区分已提交删除')
  check(failed.error?.cause instanceof Error, '最终状态写失败未保留原始原因')
  const saved = (await db.read(sql => sql.query("SELECT value FROM maintenance_state WHERE key='cleanup'")))[0]!.value
  check(JSON.parse(String(saved)).status === 'failed' && !String(saved).includes('controlled-') && !String(saved).includes('error'), '故障状态未记录或泄露底层原因')
  check(!(await db.read(sql => sql.query("SELECT id FROM ledger_entry WHERE id='final-status-due'"))).length, '已提交删除被误当失败回滚')
  await db.write(sql => sql.run('DROP TRIGGER temp.fail_final_status'))

  await due('both-status-due')
  await db.write(sql => sql.run(`CREATE TEMP TRIGGER fail_all_final_status BEFORE INSERT ON maintenance_state
    WHEN NEW.key='cleanup' AND json_extract(NEW.value,'$.status') IN ('success','failed')
    BEGIN SELECT RAISE(ABORT,'controlled-all-final-status'); END`))
  const bothFailed = await operate(() => service.run(ds))
  check(bothFailed.deleted === 1 && bothFailed.error?.cause instanceof AggregateError
    && bothFailed.error.cause.errors.length === 2, '失败状态再次写失败掩盖首错或已提交进度')
  const interrupted = JSON.parse(String((await db.read(sql => sql.query("SELECT value FROM maintenance_state WHERE key='cleanup'")))[0]!.value))
  check(interrupted.status === 'running' && interrupted.deleted === 1, '双重状态故障破坏批次断点')
  await db.write(sql => sql.run('DROP TRIGGER temp.fail_all_final_status'))
  const resumed = await operate(() => service.run(ds))
  check(resumed.status === 'success' && resumed.deleted === 0 && resumed.previousOutcome === 'interrupted', '状态故障后续作重复删除或遗漏中断')

  await due('first-batch-due')
  await db.write(sql => sql.run(`CREATE TEMP TRIGGER fail_first_cleanup BEFORE DELETE ON ledger_entry
    WHEN OLD.id='first-batch-due' BEGIN SELECT RAISE(ABORT,'controlled-first-batch'); END`))
  const noCommit = await operate(() => service.run(ds))
  check(noCommit.status === 'failed' && noCommit.deleted === 0 && noCommit.reason?.includes('未永久删除记录'), '零提交失败误报已有删除')
  check((await db.read(sql => sql.query("SELECT id FROM ledger_entry WHERE id='first-batch-due'"))).length === 1, '未提交批次丢失原数据')
  await db.write(sql => sql.run('DROP TRIGGER temp.fail_first_cleanup'))
  check((await service.run(ds)).deleted === 1 && (await f.service.getIncome(source.id)).amount === '1000.00', '失败恢复改变无关收入或未清完剩余项')
  return 'cleanup-final-state-failure-notification-partial-progress-and-bounded-recovery'
}
