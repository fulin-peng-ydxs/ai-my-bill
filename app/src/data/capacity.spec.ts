import { afterAll, afterEach, expect, it, vi } from 'vitest'
import type { createSqliteBridge } from '../../test-support/sqliteBridge'
const state = vi.hoisted(() => ({ fixture:undefined as ReturnType<typeof createSqliteBridge> | undefined }))
vi.mock('@capacitor/core',async () => {
  const { createSqliteBridge } = await import('../../test-support/sqliteBridge')
  const fixture = createSqliteBridge()
  state.fixture = fixture
  return { Capacitor:{ getPlatform:() => 'ios',isPluginAvailable:() => true },
    registerPlugin:(name:string) => name === 'CapacitorSQLite' ? fixture.sqlite : fixture.files }
})
import { LedgerDatabase } from './ledgerDatabase'
import { seedCapacity } from '../../test-support/capacityScenario'
const databases: LedgerDatabase[] = []
afterEach(async () => { for (const db of databases.splice(0)) await db.close() })
afterAll(() => state.fixture!.dispose())
it('容量夹具只接受固定规模，拒绝误用且不写正式账本',async () => {
  const db = new LedgerDatabase('capacity_invalid')
  databases.push(db)
  await db.open()
  await expect(seedCapacity(db,9999)).rejects.toThrow('仅允许')
  await expect(seedCapacity(db,10000)).rejects.toThrow('拒绝正式')
  expect((await db.read(sql => sql.query('SELECT count(*) AS n FROM ledger_entry')))[0].n).toBe(0)
})
it.each([10_000,100_000])('固定 %i 条覆盖收支、历史、退款和回收站，保留其他数据集',async count => {
  const db = new LedgerDatabase('probe_scale_'+crypto.randomUUID().replaceAll('-','')+'_main'), other = new LedgerDatabase('capacity_other_'+count)
  databases.push(db,other)
  await db.open(); await other.open()
  await seedCapacity(db,count)
  const rows = await db.read(sql => sql.query(`SELECT count(*) AS n,
    sum(entry_type='EXPENSE') AS expense,sum(entry_type='INCOME') AS income,
    sum(lifecycle_status='TRASHED') AS trash,count(DISTINCT business_date) AS days FROM ledger_entry`))
  expect(rows[0]).toEqual({ n:count,expense:count/2,income:count/2,trash:count/10-1,days:365 })
  const adjustments = await db.read(sql => sql.query('SELECT count(*) AS n FROM expense_adjustment'))
  expect(adjustments[0].n).toBe(count/20)
  expect((await db.read(sql => sql.query("SELECT count(*) AS n FROM expense_adjustment WHERE id NOT GLOB '????????-????-4???-[89ab]???-????????????'")))[0].n).toBe(0)
  expect((await other.read(sql => sql.query('SELECT count(*) AS n FROM ledger_entry')))[0].n).toBe(0)
  await expect(seedCapacity(db,count)).rejects.toBeDefined()
  expect((await db.read(sql => sql.query('SELECT count(*) AS n FROM ledger_entry')))[0].n).toBe(count)
},30_000)
