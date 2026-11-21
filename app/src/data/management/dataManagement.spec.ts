import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyFileSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import type { createSqliteBridge } from '../../../test-support/sqliteBridge'
import type { BackupManifest, LedgerTransfers } from '../../platform/ledgerTransfers'

const state = vi.hoisted(() => ({ fixture: undefined as ReturnType<typeof createSqliteBridge> | undefined }))
vi.mock('@capacitor/core', async () => {
  const { createSqliteBridge } = await import('../../../test-support/sqliteBridge')
  const fixture = createSqliteBridge()
  state.fixture = fixture
  return { Capacitor: { getPlatform: () => 'ios',isPluginAvailable: () => true },
    registerPlugin: (name: string) => name === 'CapacitorSQLite' ? fixture.sqlite : fixture.files }
})
import { LedgerDatabase } from '../ledgerDatabase'
import { DataManagementService, describeDatabase, readBackupRevision } from './dataManagement'
import { migrations } from '../migrations'
import { defaultSeed } from '../seed/defaults'
import { entryFixture } from '../../../test-support/entryScenarios'
import { csvHeaders, csvRow } from './csvExport'

let database: LedgerDatabase, service: DataManagementService, files: LedgerTransfers, directory: string
let counter = 0
const managers: LedgerDatabase[] = []
const capabilities = new Map<string, { text: string; bytes?: Uint8Array; manifest?: BackupManifest }>()
const path = (name: string) => join(directory,name+'SQLite.db')
const checksum = (name: string) => createHash('sha256').update(readFileSync(path(name))).digest('hex')
beforeEach(async () => {
  capabilities.clear()
  database = new LedgerDatabase(`manage_${++counter}`)
  managers.push(database)
  await database.open()
  directory = dirname(state.fixture!.databasePath(database.name))
  files = {
    createTransfer: vi.fn(async () => { const id = crypto.randomUUID(); capabilities.set(id,{ text: '' }); return { id } }),
    appendTransfer: vi.fn(async ({ id,text }) => { capabilities.get(id)!.text += text }),
    exportBackup: vi.fn(async ({ id,name,manifest }) => {
      capabilities.get(id)!.bytes = readFileSync(path(name))
      capabilities.get(id)!.manifest = structuredClone(manifest)
      return { id }
    }),
    prepareRestore: vi.fn(async ({ id }) => {
      const cap = capabilities.get(id)!, name = 'restore_'+id.replaceAll('-','')
      writeFileSync(path(name),cap.bytes!)
      return { name,manifest: structuredClone(cap.manifest!) }
    }),
    discardTransfer: vi.fn(async ({ id }) => { capabilities.delete(id) }),
    cancelTransfer: vi.fn(async () => {}),
    discardDatabase: vi.fn(async ({ name }) => { if (existsSync(path(name))) unlinkSync(path(name)) }),
    hashDatabase: vi.fn(async ({ name }) => ({ sha256: checksum(name) })),
    replaceLedger: vi.fn(async ({ name,prepared,sha256 }) => {
      if (checksum(prepared) !== sha256) throw new Error('controlled-prepared-drift')
      copyFileSync(path(prepared),path(name))
    }),
    saveTransfer: vi.fn(async () => ({ saved: true })), pickBackup: vi.fn(async () => ({ cancelled: true })),
    dataStatus: vi.fn(async () => ({ snapshots: 0,lastResult: '' })),
    recordDataResult: vi.fn(async () => {}),
  }
  service = new DataManagementService(database,state.fixture!.files,files,(name,origin) => {
    const value = new LedgerDatabase(name,migrations,defaultSeed,state.fixture!.files,async () => {},origin)
    managers.push(value)
    return value
  })
})
afterEach(async () => { for (const db of managers.splice(0)) await db.close(); vi.restoreAllMocks() })
afterAll(() => state.fixture!.dispose())

describe('本地导出与整库恢复', () => {
  it('CSV 沿用 39 列、BOM、引号换行与前导空白公式防护', async () => {
    expect(csvHeaders).toHaveLength(39)
    expect(csvRow(['  =SUM(1)', '@x', '"甲,乙"\n丙', '普通😀'])).toBe('"\'  =SUM(1)","\'@x","""甲,乙""\n丙","普通😀"\r\n')
    const f = await entryFixture(database)
    await f.service.createExpense({ ...f.expense,note: '  =SUM(1)' },'csv-expense')
    await f.service.createIncome(f.income,'csv-income')
    const all = await service.exportCsv({ scope: 'ALL_DATA' })
    const text = capabilities.get(all.id)!.text
    expect(text.startsWith('\uFEFF"记录ID"')).toBe(true)
    expect(text).toContain('12.3456')
    expect(text).toContain('1.250')
    expect(text).toContain('2026-11-17T09:00:00.000+08:00')
    expect(all.rows).toBe(2)
    const current = await service.exportCsv({ scope: 'CURRENT_FILTERS',query: '测试工资',type: 'ALL',lifecycle: 'ACTIVE',range: 'CUSTOM',startDate: '2026-11-01',endDate: '2026-11-30' })
    expect(current.rows).toBe(1)
    expect(capabilities.get(current.id)!.text).toContain('1000.00')
    expect(capabilities.get(current.id)!.text).not.toContain('测试苹果')
  })
  it('同时间 401 条稳定分批；导出事务阻止穿插写入，桥调用按块而非逐行', async () => {
    const f = await entryFixture(database)
    for (let i=0;i<401;i++) await f.service.createIncome({ ...f.income,incomeName: '分页'+i },'page-'+i)
    let pending: Promise<unknown> | undefined
    const append = files.appendTransfer
    files.appendTransfer = vi.fn(async options => {
      if (!pending) pending = f.service.createIncome({ ...f.income,incomeName: '导出后新增' },'after-export')
      await append(options)
    })
    const result = await service.exportCsv({ scope: 'ALL_DATA' })
    await pending
    expect(result.rows).toBe(401)
    const text = capabilities.get(result.id)!.text
    expect(text).not.toContain('导出后新增')
    expect(new Set(text.split('\r\n').slice(1,-1).map(line => line.split(',')[0])).size).toBe(401)
    expect(vi.mocked(files.appendTransfer).mock.calls.length).toBeLessThan(30)
  })
  it('分批导出取消删除内部临时文件，原账目不改变', async () => {
    const f = await entryFixture(database)
    await f.service.createIncome(f.income,'cancel-source')
    const controller = new AbortController()
    files.appendTransfer = vi.fn(async () => { controller.abort() })
    await expect(service.exportCsv({ scope: 'ALL_DATA' },controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    expect(files.discardTransfer).toHaveBeenCalledOnce()
    expect((await database.read(describeDatabase)).tables.ledger_entry).toBe(1)
  })
  it('摘要尚未完成的已受理保存先排空，清空后不会迟到写入新数据集', async () => {
    const f = await entryFixture(database)
    let release!: (value: ArrayBuffer) => void
    const original = crypto.subtle.digest.bind(crypto.subtle)
    const pendingDigest = new Promise<ArrayBuffer>(resolve => { release = resolve })
    vi.spyOn(crypto.subtle,'digest').mockImplementationOnce(() => pendingDigest)
    const oldDataset = (await database.read(describeDatabase)).datasetId
    const accepted = vi.spyOn(database,'executeOnce')
    const save = f.service.createIncome(f.income,'before-clear')
    expect(accepted).toHaveBeenCalledOnce()
    const clear = service.clear(oldDataset)
    await new Promise(resolve => setTimeout(resolve,10))
    expect(files.replaceLedger).not.toHaveBeenCalled()
    release(await original('SHA-256',new TextEncoder().encode(JSON.stringify({ input: f.income }))))
    await save
    await clear
    expect((await database.read(describeDatabase)).tables.ledger_entry).toBe(0)
  })
  it('完整备份/恢复保留用户配置及双草稿，生成新数据集，移除备份后的差异，重复恢复无副作用', async () => {
    const f = await entryFixture(database)
    await f.service.createIncome(f.income,'original-income')
    const before = await database.read(describeDatabase)
    await database.write(async sql => {
      await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
      for (const type of ['EXPENSE','INCOME']) await sql.run('INSERT INTO ledger_draft VALUES(?,?,1,?,?,?)',
        [before.datasetId,type,JSON.stringify({ amount: type === 'INCOME' ? '222' : '77' }),new Date().toISOString(),new Date().toISOString()])
    })
    const backup = await service.backup('password-测试')
    await f.service.createIncome({ ...f.income,incomeName: '备份后新增' },'later-income')
    const prepared = await service.prepare(backup.id,'password-测试')
    expect((await database.read(describeDatabase)).tables.ledger_entry).toBe(2)
    await service.restore(prepared)
    const current = await database.read(describeDatabase)
    expect(current.datasetId).not.toBe(before.datasetId)
    expect(current.tables.ledger_entry).toBe(1)
    expect(current.tables.ledger_draft).toBe(2)
    expect((await database.read(sql => sql.query('SELECT DISTINCT dataset_id FROM ledger_draft')))[0].dataset_id).toBe(current.datasetId)
    expect((await database.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0].value).toBe('"DARK"')
    await service.restore(prepared)
    expect(files.replaceLedger).toHaveBeenCalledOnce()
  })
  it('未知版本、清单数量/身份不符及空 SQLite 均不重铺 seed 或替换当前账本', async () => {
    const backup = await service.backup('password1')
    const manifest = capabilities.get(backup.id)!.manifest!
    const original = structuredClone(manifest), before = await database.read(describeDatabase)
    for (const changed of [{ ...original,backupFormatVersion: 2 },{ ...original,schemaVersion: 999 },
      { ...original,datasetId: crypto.randomUUID() },{ ...original,tables: { ...original.tables,ledger_entry: 5 } }]) {
      capabilities.get(backup.id)!.manifest = changed as BackupManifest
      await expect(service.prepare(backup.id,'password1')).rejects.toBeDefined()
      expect(await database.read(describeDatabase)).toMatchObject({ datasetId: before.datasetId,tables: before.tables })
    }
    capabilities.get(backup.id)!.manifest = original
    capabilities.get(backup.id)!.bytes = new Uint8Array()
    await expect(service.prepare(backup.id,'password1')).rejects.toMatchObject({ code: 'DATABASE_INCOMPATIBLE' })
    expect(files.replaceLedger).not.toHaveBeenCalled()
  })
  it('恢复拒绝 schema/FK 仍合法的超额调整或其他数据集草稿，保留当前账本', async () => {
    const f = await entryFixture(database)
    const expense = await f.service.createExpense(f.expense,'source-invariant')
    const backup = await service.backup('password1')
    const cap = capabilities.get(backup.id)!, original = cap.bytes!
    const candidate = join(directory,'controlled-invalid-'+counter+'.db')
    const forge = (change: (db: DatabaseSync) => void) => {
      writeFileSync(candidate,original)
      const db = new DatabaseSync(candidate)
      try { change(db) } finally { db.close() }
      cap.bytes = readFileSync(candidate)
      unlinkSync(candidate)
    }
    forge(db => {
      const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE name='adjustment_validate_insert'").get()!.sql as string
      db.exec('DROP TRIGGER adjustment_validate_insert')
      db.prepare("INSERT INTO expense_adjustment(id,original_expense_id,adjustment_type,amount_cents,business_time,business_date,created_at,updated_at) VALUES(?,?,'REFUND',2000,?,?,?,?)")
        .run(crypto.randomUUID(),expense.id,f.now.toISOString(),'2026-11-17',f.now.toISOString(),f.now.toISOString())
      db.exec(trigger)
    })
    cap.manifest!.tables.expense_adjustment = 1
    await expect(service.prepare(backup.id,'password1')).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    cap.manifest!.tables.expense_adjustment = 0
    forge(db => { db.prepare('INSERT INTO ledger_draft VALUES(?,?,1,?,?,?)').run('other-dataset','INCOME','{"amount":"1"}',f.now.toISOString(),f.now.toISOString()) })
    cap.manifest!.tables.ledger_draft = 1
    await expect(service.prepare(backup.id,'password1')).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    expect(files.replaceLedger).not.toHaveBeenCalled()
    const actual = await database.read(describeDatabase)
    expect(actual.tables.expense_adjustment).toBe(0)
    expect(actual.tables.ledger_draft).toBe(0)
    expect(actual.datasetId).toBe(backup.manifest.datasetId)
  })
  it('恢复前保护失败、准备库漂移或提前取消，原账本仍可读写', async () => {
    const backup = await service.backup('password1'), prepared = await service.prepare(backup.id,'password1')
    const original = await database.read(describeDatabase)
    const snapshot = vi.spyOn(state.fixture!.files,'snapshot').mockRejectedValueOnce(new Error('controlled-protection-failure'))
    await expect(service.restore(prepared)).rejects.toThrow('controlled-protection-failure')
    snapshot.mockRestore()
    const controller = new AbortController();controller.abort()
    await expect(service.restore(prepared,controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    writeFileSync(path(prepared.name),'controlled-file-drift')
    await expect(service.restore(prepared)).rejects.toThrow('controlled-prepared-drift')
    expect((await database.read(describeDatabase)).datasetId).toBe(original.datasetId)
    await database.write(sql => sql.run("UPDATE preference SET value='false' WHERE key='theme'"))
  })
  it('清空新建当前 seed 数据集；旧数据集的重试被拒绝，外部备份可再次恢复', async () => {
    const f = await entryFixture(database)
    await f.service.createIncome(f.income,'clear-source')
    const before = await database.read(describeDatabase), backup = await service.backup('password1')
    await service.clear(before.datasetId)
    const empty = await database.read(describeDatabase)
    expect(empty.datasetId).not.toBe(before.datasetId)
    expect(empty.tables.ledger_entry).toBe(0)
    expect(empty.tables.dictionary_item).toBe(defaultSeed.items.length)
    await expect(service.clear(before.datasetId)).rejects.toMatchObject({ code: 'DATASET_CHANGED' })
    await service.restore(await service.prepare(backup.id,'password1'))
    expect((await database.read(describeDatabase)).tables.ledger_entry).toBe(1)
  })
  it('文件窗口开始即拒绝新任务、先排空已受理写入，并在文件失败后恢复原库', async () => {
    let release!: () => void
    const slow = database.write(async sql => { await new Promise<void>(resolve => { release=resolve }); await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'") })
    await Promise.resolve()
    const maintenance = database.withClosed(async () => { throw new Error('controlled-copy-failure') })
    await expect(database.read(async () => 1)).rejects.toMatchObject({ code: 'DATABASE_BUSY' })
    release();await slow
    await expect(maintenance).rejects.toThrow('controlled-copy-failure')
    expect((await database.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0].value).toBe('"DARK"')
  })
  it('常规快照窗口让正常读写有界排队，关闭完成后继续执行', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release=resolve })
    let started = false
    const window = database.withClosed(async () => { await gate },undefined,true)
    await Promise.resolve()
    const queued = database.read(async sql => { started = true;return sql.query('SELECT dataset_id FROM ledger_meta') })
    await Promise.resolve()
    expect(started).toBe(false)
    release()
    await window
    expect((await queued)[0].dataset_id).toBeTypeOf('string')
  })
  it('事务变更标记跨重开稳定，实际写入更新，回滚和幂等回放不制造新变更', async () => {
    const before = await database.read(readBackupRevision)
    await database.close();await database.open()
    expect(await database.read(readBackupRevision)).toBe(before)
    await database.executeOnce('probe.revision','once','a'.repeat(64),async sql => {
      await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
      return { ok: true }
    })
    const changed = await database.read(readBackupRevision)
    await database.write(sql => sql.run("INSERT INTO maintenance_state VALUES('clock','{}') ON CONFLICT(key) DO UPDATE SET value=excluded.value"))
    expect(await database.read(readBackupRevision)).toBe(changed)
    expect(changed).not.toBe(before)
    await database.executeOnce('probe.revision','once','a'.repeat(64),async () => { throw new Error('不应回放写入') })
    expect(await database.read(readBackupRevision)).toBe(changed)
    await expect(database.write(async sql => {
      await sql.run("UPDATE preference SET value='\"LIGHT\"' WHERE key='theme'")
      throw new Error('controlled-rollback')
    })).rejects.toThrow('controlled-rollback')
    expect(await database.read(readBackupRevision)).toBe(changed)
  })
  it('自动快照取消回执迟到也先等待回执，再回收该代次，延期不伪称已完成', async () => {
    const controller = new AbortController()
    let finish!: () => void
    vi.mocked(files.cancelTransfer).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    vi.spyOn(state.fixture!.files,'snapshot').mockImplementationOnce(async () => {
      controller.abort()
      return { id: 'snapshot',bytes: 1,sha256: 'a'.repeat(64),excluded: true,protected: false,simulator: true }
    })
    const daily = service.daily(controller.signal)
    await vi.waitFor(() => expect(files.cancelTransfer).toHaveBeenCalledOnce())
    const id = vi.mocked(files.cancelTransfer).mock.calls[0][0].id
    expect(files.discardTransfer).not.toHaveBeenCalled()
    expect(await service.daily()).toBe(false)
    finish()
    expect(await daily).toBe(true)
    expect(files.discardTransfer).toHaveBeenCalledExactlyOnceWith({ id })
  })
  it('已安装同版本账本只补快照水位，空字典与用户偏好不补种覆盖', async () => {
    await database.write(async sql => {
      await sql.run('DELETE FROM dictionary_item')
      await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
    })
    // 绕过生产写入模拟升级前已安装数据库缺少运行期水位，不能被 write 自动补回。
    await database.withClosed(async () => {
      const db = new DatabaseSync(path(database.name))
      try { db.exec("DELETE FROM maintenance_state WHERE key='backup_revision'") } finally { db.close() }
    })
    expect(await database.read(readBackupRevision)).toMatch(/^[a-f0-9-]{36}$/)
    expect((await database.read(describeDatabase)).tables.dictionary_item).toBe(0)
    expect((await database.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0].value).toBe('"DARK"')
  })
  it('已知 v5 备份在临时库升级，用户字典/偏好保留，不用当前 seed 补造', async () => {
    const legacy = new LedgerDatabase('legacy_manage_'+counter,migrations.slice(0,5))
    managers.push(legacy)
    await legacy.open()
    await legacy.write(async sql => {
      await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
      await sql.run("INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES(?,'PAYER','旧版付款方','旧版付款方','ACTIVE')",[crypto.randomUUID()])
    })
    const source = new DataManagementService(legacy,state.fixture!.files,files)
    const backup = await source.backup('password1')
    expect(backup.manifest.schemaVersion).toBe(5)
    await service.restore(await service.prepare(backup.id,'password1'))
    const current = await database.read(describeDatabase)
    expect(current.schemaVersion).toBe(8)
    expect((await database.read(sql => sql.query("SELECT name FROM dictionary_item WHERE name='旧版付款方'")))).toHaveLength(1)
    expect((await database.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0].value).toBe('"DARK"')
  })
})
