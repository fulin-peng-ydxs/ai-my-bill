import { withProbeDatabases } from './probeDatabases'
import { entryFixture } from '../test-support/entryScenarios'
import { DataManagementService, describeDatabase, readBackupRevision } from '../src/data/management/dataManagement'
import { ledgerTransfers } from '../src/platform/ledgerTransfers'
import { ledgerFiles } from '../src/platform/ledgerFiles'
import { LedgerDatabase } from '../src/data/ledgerDatabase'
import { migrations } from '../src/data/migrations'
import { ReportQueryService } from '../src/data/reports/reportQueryService'
import { DraftService } from '../src/data/personal/draftService'
import { defaultSeed } from '../src/data/seed/defaults'

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

/** 使用真实原生 SQLite、分块认证加密及文件替换；随机库不清空正式账本或弹出系统文件选择。 */
export async function dataManagement() {
  return withProbeDatabases('data', async (manager, prefix) => {
    const database = manager('main')
    await database.open()
    const staged: LedgerDatabase[] = [], transfers: string[] = []
    const service = new DataManagementService(database,ledgerFiles,ledgerTransfers,(name,origin) => {
      const value = new LedgerDatabase(name,migrations,defaultSeed,ledgerFiles,async () => {},origin)
      staged.push(value)
      return value
    })
    try {
      const f = await entryFixture(database)
      await f.service.createExpense(f.expense,'source-expense')
      await f.service.createIncome(f.income,'source-income')
      const source = await database.read(describeDatabase)
      await database.write(async sql => {
        await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
        for (const type of ['EXPENSE','INCOME']) await sql.run('INSERT INTO ledger_draft VALUES(?,?,1,?,?,?)',
          [source.datasetId,type,JSON.stringify(type === 'EXPENSE' ? { paidAmount: '77' } : { amount: '222' }),new Date().toISOString(),new Date().toISOString()])
      })
      const csv = await service.exportCsv({ scope: 'ALL_DATA' })
      transfers.push(csv.id)
      check(csv.rows === 2,'原生 CSV 行数不符')
      const report = new ReportQueryService(database,() => f.now)
      const beforeReport = await report.snapshot({ scope: 'ALL',query: '',range: 'TODAY' })
      const backup = await service.backup('Native-备份-password')
      transfers.push(backup.id)
      try {
        await service.prepare(backup.id,'wrong-password')
        throw new Error('错误密码被接受')
      } catch (error) { check((error as { code?: string }).code === 'BACKUP_AUTHENTICATION_FAILED','错误密码未按认证失败拒绝') }
      const prepared = await service.prepare(backup.id,'Native-备份-password')
      await f.service.createIncome({ ...f.income,incomeName: '备份后差异' },'later-income')
      await service.restore(prepared)
      const restored = await database.read(describeDatabase)
      check(restored.datasetId !== source.datasetId && restored.tables.ledger_entry === 2 && restored.tables.ledger_draft === 2,'整库恢复或数据集隔离错误')
      check(JSON.stringify(await report.snapshot({ scope: 'ALL',query: '',range: 'TODAY' })) === JSON.stringify(beforeReport),'恢复后的实际报表金额/覆盖范围不一致')
      const drafts = new DraftService(database)
      check((await drafts.read(restored.datasetId,'EXPENSE')).paidAmount === '77' && (await drafts.read(restored.datasetId,'INCOME')).amount === '222','恢复后双类型草稿关键值错误')
      const draft = await database.read(sql => sql.query('SELECT DISTINCT dataset_id FROM ledger_draft'))
      check(draft.length === 1 && draft[0].dataset_id === restored.datasetId,'恢复草稿归属错误')
      check((await database.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0].value === '"DARK"','用户偏好被默认值覆盖')
      await service.restore(prepared)
      await database.close()
      await database.open()
      check((await database.read(describeDatabase)).datasetId === restored.datasetId,'重启后恢复结果未保留')
      const snapshot = (day: string) => database.withClosed(revision => ledgerFiles.snapshot({ name: database.name,reason: 'daily',day,revision }),readBackupRevision)
      const first = await snapshot('2026-12-01')
      check(!first.skipped,'有变更时未创建常规快照')
      await database.write(sql => sql.run("UPDATE preference SET value='\"LIGHT\"' WHERE key='theme'"))
      const sameDay = await snapshot('2026-12-01')
      check(sameDay.skipped,'同日重复创建常规快照')
      const nextDay = await snapshot('2026-12-02')
      check(!nextDay.skipped,'跨日变更未创建快照')
      const unchanged = await snapshot('2026-12-03')
      check(unchanged.skipped,'无变更仍创建常规快照')

      const legacy = manager('legacy',migrations.slice(0,5))
      await legacy.open()
      await legacy.write(async sql => {
        await sql.run("INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES(?,'PAYER','旧用户付款方','旧用户付款方','ACTIVE')",[crypto.randomUUID()])
        await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
      })
      const legacyService = new DataManagementService(legacy)
      const oldBackup = await legacyService.backup('Native-old-version')
      transfers.push(oldBackup.id)
      check(oldBackup.manifest.schemaVersion === 5,'未创建受控旧版本格式')
      await service.restore(await service.prepare(oldBackup.id,'Native-old-version'))
      check((await database.read(describeDatabase)).schemaVersion === 8,'临时库未通过正式升级链')
      check((await database.read(sql => sql.query("SELECT name FROM dictionary_item WHERE name='旧用户付款方'"))).length === 1,'旧用户配置未保留')
      check((await database.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0].value === '"DARK"','旧备份被新默认覆盖')
      return { schemaVersion: migrations.length,databasePrefix: prefix,checks: ['csv','authenticated-backup','wrong-password','atomic-restore','draft-scope','repeat-reopen','report-readback','daily-policy','legacy-upgrade'] }
    } finally {
      for (const item of staged) await item.close()
      for (const id of transfers) {
        await ledgerTransfers.discardDatabase({ name: 'restore_'+id.replaceAll('-','') })
        await ledgerTransfers.discardTransfer({ id })
      }
    }
  })
}
