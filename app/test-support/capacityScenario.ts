import type { LedgerDatabase } from '../src/data/ledgerDatabase'
import { entryFixture } from './entryScenarios'
import { EntryReadbackQuery } from '../src/data/entries/readbackQuery'
import { ReportQueryService } from '../src/data/reports/reportQueryService'
import { DataManagementService, describeDatabase } from '../src/data/management/dataManagement'
import { ledgerTransfers } from '../src/platform/ledgerTransfers'
import type { ExpenseReportDimension, IncomeReportDimension, ReportTimeGrain } from '../src/api/reports'

export const capacityFixture = { version: 1, epoch: '2026-11-17T01:00:00.000Z', days: 365,
  expensePercent: 50, trashedPercent: 10, refundPercent: 5,retention:'30-days-from-run-time' } as const

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

/** 正式迁移和服务先生成两笔样本，按列克隆；有界批次，不假造 schema/版本履历。 */
export async function seedCapacity(database: LedgerDatabase, count: number) {
  if (count !== 10_000 && count !== 100_000) throw new Error('容量夹具仅允许 1 万/10 万条')
  if (!/^probe_scale_[a-f0-9]{32}_main$/.test(database.name)) throw new Error('容量夹具拒绝正式或非受管数据库')
  check((await database.read(sql => sql.query('SELECT count(*) AS n FROM ledger_entry')))[0]?.n === 0,'容量夹具拒绝非空数据库')
  const f = await entryFixture(database)
  const expense = await f.service.createExpense(f.expense, 'scale-expense')
  const income = await f.service.createIncome(f.income, 'scale-income')
  const retentionAnchor = new Date().toISOString(), purgeAfter = new Date(Date.parse(retentionAnchor)+30*86400000).toISOString()
  await database.write(async sql => {
    const columns = (await sql.query('PRAGMA table_info(ledger_entry)')).map(row => String(row.name))
    check(columns.every(name => /^[a-z_]+$/.test(name)), '无法识别账目列')
    for (let start = 2; start < count; start += 500) {
      const end = Math.min(count - 1, start + 499)
      const expressions = columns.map(name => name === 'id'
        ? "printf('00000000-0000-4000-8000-%012d',n)" : name === 'business_date'
          ? "date('2026-11-17',printf('-%d days',n%365))" : ['business_time','created_at','updated_at'].includes(name)
            ? "strftime('%Y-%m-%dT01:00:00.000Z','2026-11-17',printf('-%d days',n%365))" : `l."${name}"`)
      await sql.run(`WITH RECURSIVE seq(n) AS (SELECT ? UNION ALL SELECT n+1 FROM seq WHERE n<?)
        INSERT INTO ledger_entry(${columns.map(name => `"${name}"`).join(',')})
        SELECT ${expressions.join(',')} FROM seq JOIN ledger_entry l ON l.id=CASE WHEN n%2=0 THEN ? ELSE ? END`,
      [start,end,expense.id,income.id])
    }
    await sql.run(`INSERT INTO expense_adjustment(id,original_expense_id,adjustment_type,amount_cents,
      business_time,business_date,status,created_at,updated_at)
      SELECT '10000000-0000-4000-8000-'||substr(id,-12),id,'REFUND',100,business_time,business_date,'EFFECTIVE',created_at,updated_at
      FROM ledger_entry WHERE id LIKE '00000000-%' AND CAST(substr(id,-12) AS INTEGER)%20=2`)
    await sql.run(`UPDATE ledger_entry SET lifecycle_status='TRASHED',deleted_at=?,
      purge_after=? WHERE id LIKE '00000000-%' AND CAST(substr(id,-12) AS INTEGER)%10=0`,[retentionAnchor,purgeAfter])
    await sql.run("UPDATE ledger_meta SET history_start='2025-11-18T00:00:00.000Z'")
    check((await sql.query('PRAGMA integrity_check'))[0]?.integrity_check === 'ok', '容量夹具损坏')
    check((await sql.query('PRAGMA foreign_key_check')).length === 0, '容量夹具存在孤儿')
    check((await sql.query('SELECT count(*) AS n FROM ledger_entry'))[0]?.n === count, '容量夹具数量不符')
  })
  return { ...f,retentionAnchor }
}

/** 数据/桥/加密文件观测；名称明确区分页面端到端指标，不能冒充 D07 真机验收。 */
export async function observeCapacity(database: LedgerDatabase, count: number, mode: 'simulator' | 'device' = 'simulator') {
  await database.open()
  const f = await seedCapacity(database, count)
  const iterations = mode === 'device' ? 30 : 3, heavyIterations = mode === 'device' ? 5 : 1
  const samples: Record<string, number[]> = {}
  const spans: Record<string, { start:number,end:number }[]> = {}
  const measure = async (key: string, times: number, task: (iteration: number) => Promise<unknown>) => {
    samples[key] = []; spans[key] = []
    for (let i = 0; i < times; i++) {
      const start = performance.timeOrigin + performance.now()
      await task(i)
      const end = performance.timeOrigin + performance.now()
      samples[key].push(end - start); spans[key].push({ start,end })
    }
    console.log('IOS_CAPACITY_STAGE '+key+' '+Math.round(samples[key].reduce((sum,value) => sum+value,0))+'ms')
  }
  const query = new EntryReadbackQuery(database, () => f.now)
  await measure('sqlite.list',iterations,async () => {
    const page = await query.list({ query:'',type:'ALL',lifecycle:'ACTIVE',range:'CUSTOM',startDate:'2025-11-18',endDate:'2026-11-17' })
    check(page.items.length === 20 && page.nextCursor, '容量明细首屏不完整')
  })
  await measure('sqlite.save',iterations,i => f.service.createExpense(f.expense, `scale-save-${i}`))
  const reports = new ReportQueryService(database, () => f.now)
  const filters = { query:'',range:'CUSTOM' as const,startDate:'2025-11-18',endDate:'2026-11-17' }
  await measure('sqlite.overview',iterations,() => reports.snapshot({ ...filters,scope:'ALL' }))
  for (const grain of ['DAY','WEEK','MONTH','QUARTER','YEAR'] as ReportTimeGrain[])
    await measure('sqlite.time.'+grain,iterations,() => reports.snapshot({ ...filters,scope:'ALL' },grain))
  for (const [scope,dimensions] of [
    ['EXPENSE',['CATEGORY','PRODUCT','FUNDING_CHANNEL','PURCHASE_CHANNEL','LOCATION','HABIT','PRICE','FREQUENCY','QUALITY']],
    ['INCOME',['CATEGORY','FUNDING_CHANNEL','PAYER','NAME','FREQUENCY']],
  ] as const) for (const dimension of dimensions)
    await measure(`sqlite.${scope}.${dimension}`,iterations,() => reports.snapshot({ ...filters,scope },undefined,undefined,dimension as ExpenseReportDimension | IncomeReportDimension))
  const management = new DataManagementService(database)
  samples['files.backup'] = []; spans['files.backup'] = []
  for (let i = 0; i < heavyIterations; i++) {
    const start = performance.timeOrigin + performance.now()
    const backup = await management.backup('Synthetic-scale-password-2026')
    const end = performance.timeOrigin + performance.now()
    samples['files.backup'].push(end - start); spans['files.backup'].push({ start,end })
    try {
      await measureOnceRestore(backup.id)
    } finally { await ledgerTransfers.discardTransfer({ id:backup.id }) }
  }
  async function measureOnceRestore(id: string) {
    const start = performance.timeOrigin + performance.now()
    const prepared = await management.prepare(id,'Synthetic-scale-password-2026')
    try {
      await management.restore(prepared)
      check((await database.read(describeDatabase)).tables.ledger_entry === count + iterations,'恢复数量改变')
      const end = performance.timeOrigin + performance.now()
      ;(samples['files.restore'] ??= []).push(end - start)
      ;(spans['files.restore'] ??= []).push({ start,end })
    } finally { await ledgerTransfers.discardDatabase({ name:prepared.name }) }
  }
  return { fixture:{ ...capacityFixture,retentionAnchor:f.retentionAnchor },count,samples,spans,mode,measurementScope:'native-services-not-page-e2e',
    sqliteVersion:await database.read(sql => sql.query('SELECT sqlite_version() AS version')) }
}
