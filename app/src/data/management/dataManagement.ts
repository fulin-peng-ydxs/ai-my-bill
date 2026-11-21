import { LedgerDatabase, type SqlSession } from '../ledgerDatabase'
import { appDatabase } from '../appDatabase'
import { migrations } from '../migrations'
import { defaultSeed } from '../seed/defaults'
import { ledgerFiles, type LedgerFiles } from '../../platform/ledgerFiles'
import { ledgerTransfers, type BackupManifest, type LedgerTransfers } from '../../platform/ledgerTransfers'
import { LocalError, throwIfCancelled } from '../../domain/localError'
import { formatShanghaiBusinessDate } from '../../domain/businessTime'
import type { ExportRequest } from '../../api/exports'
import { writeCsv } from './csvExport'
import { unicodeCodePointLength } from '../../domain/text'

export async function describeDatabase(sql: SqlSession): Promise<BackupManifest> {
  const meta = (await sql.query('SELECT * FROM ledger_meta WHERE singleton=1'))[0]
  const names = await sql.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  const tables: Record<string, number> = {}
  for (const row of names) {
    const name = String(row.name)
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new LocalError('BACKUP_INVALID', '账本对象不兼容。')
    tables[name] = Number((await sql.query(`SELECT COUNT(*) AS n FROM "${name}"`))[0].n)
  }
  return { backupFormatVersion: 1, schemaVersion: Number(meta.schema_version), datasetId: String(meta.dataset_id),
    initialized: 1, seedVersion: Number(meta.seed_version), historyStart: String(meta.history_start), createdAt: new Date().toISOString(), tables }
}

export function assertBackupManifest(info: BackupManifest) {
  if (!info || Object.keys(info).some(key => !['backupFormatVersion','schemaVersion','datasetId','initialized','seedVersion','historyStart','createdAt','tables','bytes','sha256'].includes(key)) ||
      typeof info.createdAt !== 'string' || !Number.isFinite(Date.parse(info.createdAt)) || info.backupFormatVersion !== 1 || !Number.isInteger(info.schemaVersion) || info.schemaVersion < 1 || info.schemaVersion > migrations.length ||
      info.initialized !== 1 || typeof info.datasetId !== 'string' || !info.datasetId || info.datasetId.length > 128 ||
      !Number.isSafeInteger(info.seedVersion) || typeof info.historyStart !== 'string' || !Number.isFinite(Date.parse(info.historyStart)) ||
      !info.tables || Array.isArray(info.tables) || Object.keys(info.tables).length > 64 ||
      Object.entries(info.tables).some(([key,n]) => !/^[a-z][a-z0-9_]*$/.test(key) || !Number.isSafeInteger(n) || n < 0)) {
    throw new LocalError('BACKUP_INCOMPATIBLE', '备份格式、版本或对象清单不兼容，请使用对应版本。')
  }
}

/** 行约束之外的跨行恢复不变量；只读已升级的候选库，拒绝混入其他数据集或失衡调整。 */
async function verifyRestorableContent(sql: SqlSession) {
  const invalid = await sql.query(`SELECT 1 AS invalid FROM expense_adjustment a JOIN ledger_entry l ON l.id=a.original_expense_id
    WHERE l.entry_type<>'EXPENSE' OR (a.status='EFFECTIVE' AND l.lifecycle_status<>'ACTIVE')
      OR (a.status='SOURCE_FROZEN' AND l.lifecycle_status<>'TRASHED')
    UNION ALL SELECT 1 FROM expense_adjustment WHERE status IN ('EFFECTIVE','SOURCE_FROZEN')
      GROUP BY original_expense_id HAVING SUM(amount_cents)>(SELECT amount_cents FROM ledger_entry WHERE id=original_expense_id)
    UNION ALL SELECT 1 FROM ledger_draft WHERE dataset_id<>(SELECT dataset_id FROM ledger_meta) LIMIT 1`)
  if (invalid.length) throw new LocalError('BACKUP_INVALID','备份中的调整关联、累计金额或草稿归属不一致，当前账本未改变。')
}

export async function readBackupRevision(sql: SqlSession): Promise<string> {
  const row = (await sql.query("SELECT value FROM maintenance_state WHERE key='backup_revision'"))[0]
  const value = row && JSON.parse(String(row.value))
  if (typeof value?.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(value.revision)) {
    throw new LocalError('SNAPSHOT_METADATA_INVALID','内部快照变更标记不可用，请保留账本并重试。')
  }
  return value.revision
}

export interface PreparedRestore {
  id: string
  name: string
  manifest: BackupManifest
  targetDatasetId: string
  sha256: string
}

/** 管理操作串行且有界；原生文件接收受管标识，恢复校验与普通启动共用迁移器。 */
export class DataManagementService {
  private running = false
  constructor(private readonly database: LedgerDatabase,
    private readonly files: LedgerFiles = ledgerFiles, private readonly transfers: LedgerTransfers = ledgerTransfers,
    private readonly manager: (name: string, origin?: BackupManifest) => LedgerDatabase = (name, origin) =>
      new LedgerDatabase(name, migrations, defaultSeed, files, async () => {}, origin)) {}

  private async exclusive<T>(task: () => Promise<T>): Promise<T> {
    if (this.running) throw new LocalError('DATA_OPERATION_BUSY', '请先完成当前数据操作。', { retryable: true })
    this.running = true
    try { return await task() }
    finally { this.running = false }
  }

  exportCsv(request: ExportRequest, signal?: AbortSignal) {
    return this.exclusive(() => writeCsv(this.database,this.transfers,request,signal))
  }

  backup(password: string, signal?: AbortSignal) {
    return this.exclusive(async () => {
      this.password(password,true)
      const { id } = await this.transfers.createTransfer({ kind: 'backup' })
      const cancel = () => { void this.transfers.cancelTransfer({ id }).catch(() => {}) }
      signal?.addEventListener('abort',cancel,{ once: true })
      try {
        throwIfCancelled(signal)
        // 元信息和关闭后的文件来自同一队列窗口，不在两者之间接纳写入。
        const manifest = await this.database.withClosed(async manifest => {
          await this.transfers.exportBackup({ id,name: this.database.name,password,manifest })
          return manifest
        }, describeDatabase)
        throwIfCancelled(signal)
        return { id,manifest }
      } catch (error) {
        try { await this.transfers.discardTransfer({ id }) }
        catch (cleanup) { throw new AggregateError([error,cleanup], '备份失败且临时文件清理失败。') }
        throw error
      } finally { signal?.removeEventListener('abort',cancel) }
    })
  }

  prepare(id: string, password: string, signal?: AbortSignal): Promise<PreparedRestore> {
    return this.exclusive(async () => {
      this.password(password)
      const cancel = () => { void this.transfers.cancelTransfer({ id }).catch(() => {}) }
      signal?.addEventListener('abort',cancel,{ once: true })
      let staged: LedgerDatabase | undefined
      let name: string | undefined
      try {
        throwIfCancelled(signal)
        const decoded = await this.transfers.prepareRestore({ id,password })
        name = decoded.name
        throwIfCancelled(signal)
        if (!/^restore_[a-f0-9]{32}$/.test(name)) throw new LocalError('BACKUP_INVALID','恢复目标标识无效。')
        assertBackupManifest(decoded.manifest)
        staged = this.manager(name, decoded.manifest)
        await staged.open()
        await staged.read(verifyRestorableContent,signal)
        throwIfCancelled(signal)
        const targetDatasetId = crypto.randomUUID()
        await staged.write(async sql => {
          // 每次恢复有新的运行期数据集身份；内容/来源保留，旧任务不能命中新库中的同名草稿。
          await sql.run('UPDATE ledger_draft SET dataset_id=? WHERE dataset_id=?',[targetDatasetId,decoded.manifest.datasetId])
          await sql.run('UPDATE ledger_meta SET dataset_id=? WHERE singleton=1',[targetDatasetId])
        },signal)
        await staged.close()
        staged = undefined
        const { sha256 } = await this.transfers.hashDatabase({ name })
        await this.transfers.recordDataResult({ result: 'restore-ready' })
        return { id,name,manifest: decoded.manifest,targetDatasetId,sha256 }
      } catch (error) {
        const failures = [error]
        try { await staged?.close(); staged = undefined } catch (close) { failures.push(close) }
        if (name && !staged) {
          try { await this.transfers.discardDatabase({ name }) } catch (cleanup) { failures.push(cleanup) }
        }
        if (failures.length > 1) throw new AggregateError(failures, '恢复校验失败且清理未完成。')
        throw error
      } finally { signal?.removeEventListener('abort',cancel) }
    })
  }

  restore(prepared: PreparedRestore, signal?: AbortSignal) {
    return this.exclusive(async () => {
      throwIfCancelled(signal)
      if ((await this.database.read(describeDatabase)).datasetId === prepared.targetDatasetId) return
      if (!/^[a-f0-9]{64}$/.test(prepared.sha256) || prepared.name !== 'restore_' + prepared.id.replaceAll('-','').toLowerCase()) {
        throw new LocalError('BACKUP_INVALID','恢复预览已经失效，请重新选择文件。')
      }
      let snapshot: Awaited<ReturnType<LedgerFiles['snapshot']>> | undefined
      let failure: unknown
      try {
        await this.database.withClosed(async () => {
          snapshot = await this.files.snapshot({ name: this.database.name,reason: 'restore' })
          if (!snapshot.excluded || (!snapshot.protected && !snapshot.simulator) || !snapshot.sha256) throw new LocalError('SNAPSHOT_FAILED','恢复保护快照未完成。')
          throwIfCancelled(signal)
          await this.transfers.replaceLedger({ name: this.database.name,prepared: prepared.name,operationId: prepared.id,clear: false,sha256: prepared.sha256 })
        })
      } catch (error) {
        failure = error
        throw error
      } finally {
        if (snapshot) {
          try { await this.files.finishSnapshot?.({ id: snapshot.id }) }
          catch (cleanup) {
            if (failure) throw new AggregateError([failure,cleanup], '恢复失败且保护快照收尾失败。')
            throw cleanup
          }
        }
      }
    })
  }

  clear(expectedDataset: string, signal?: AbortSignal) {
    return this.exclusive(async () => {
      throwIfCancelled(signal)
      if ((await this.database.read(describeDatabase)).datasetId !== expectedDataset) throw new LocalError('DATASET_CHANGED','账本已切换，请重新确认清空范围。')
      const id = crypto.randomUUID(), name = 'fresh_' + id.replaceAll('-','')
      const fresh = this.manager(name)
      let closed = false, failure: unknown
      try {
        await fresh.open()
        const info = await fresh.read(describeDatabase)
        await fresh.close()
        closed = true
        const { sha256 } = await this.transfers.hashDatabase({ name })
        throwIfCancelled(signal)
        await this.database.withClosed(() => this.transfers.replaceLedger({ name: this.database.name,prepared: name,operationId: id,clear: true,sha256 }))
        return info.datasetId
      } catch (error) {
        failure = error
        try { await fresh.close(); closed = true }
        catch (close) { throw new AggregateError([error,close], '清空未完成且准备库关闭失败。') }
        throw error
      } finally {
        if (closed) {
          try { await this.transfers.discardDatabase({ name }) }
          catch (cleanup) {
            if (failure) throw new AggregateError([failure,cleanup], '清空失败且准备文件清理失败。')
            throw cleanup
          }
        }
      }
    })
  }

  daily(signal?: AbortSignal) {
    if (this.running || signal?.aborted) return Promise.resolve(false)
    return this.exclusive(async () => {
      throwIfCancelled(signal)
      const operationId = crypto.randomUUID()
      let cancellation = Promise.resolve()
      let failure: unknown
      const cancel = () => { cancellation = this.transfers.cancelTransfer({ id: operationId }).catch(() => {}) }
      signal?.addEventListener('abort',cancel,{ once: true })
      try {
        await this.database.withClosed(async revision => {
          throwIfCancelled(signal)
          await this.files.snapshot({ name: this.database.name,reason: 'daily',day: formatShanghaiBusinessDate(),operationId,revision })
        },readBackupRevision,true)
        return true
      } catch (cause) { failure = cause; throw cause }
      finally {
        signal?.removeEventListener('abort',cancel)
        // 等待迟到的取消桥回执后再清理，不能让已结束的快照代次遗留取消标记。
        await cancellation
        try { await this.transfers.discardTransfer({ id: operationId }) }
        catch (cleanup) {
          if (failure) throw new AggregateError([failure,cleanup],'内部快照失败且取消状态清理未完成。')
          throw cleanup
        }
      }
    })
  }

  private password(password: string, creating = false) {
    const length = new TextEncoder().encode(password).length
    if (creating && unicodeCodePointLength(password) < 8) throw new LocalError('BACKUP_PASSWORD_INVALID','备份密码至少需要 8 个字符。')
    if (length < 8 || length > 1024) throw new LocalError('BACKUP_PASSWORD_INVALID','备份密码长度不符合要求，请检查或缩短后重试。')
  }
}

export const dataManagement = new DataManagementService(appDatabase)
