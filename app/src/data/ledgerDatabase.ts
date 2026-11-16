import type { NativeDatabase } from '../infrastructure/database/nativeAdapter'
import { LocalError, throwIfCancelled } from '../domain/localError'
import { nativeSqlite, createIosDatabase } from '../infrastructure/database/nativeConnection'
import { SerialQueue } from '../infrastructure/database/serialQueue'
import { ledgerFiles, type LedgerFiles } from '../platform/ledgerFiles'
import { migrations, sha256, type Migration } from './migrations'
import { assertSchema, type SchemaObject } from './migrations/schema'
import { defaultSeed, seedValues, type Seed } from './seed/defaults'

export interface SqlSession {
  query(sql: string, values?: (string | number | null)[]): Promise<Record<string, unknown>[]>
  run(sql: string, values?: (string | number | null)[]): Promise<number>
}
export type LifecycleStage = 'snapshot-ready' | 'migration-recorded' | 'upgrade-committed'
/** 进度观察依赖只传阶段/版本，不暴露连接；测试 bundle 可在真实路径观察到阶段后挂起。 */
export type LifecycleObserver = (stage: LifecycleStage, version: number) => Promise<void>
const owners = new Set<string>()

/** 单一账本所有者：初始化/升级/读写/关闭共享队列，外部不能取得原生连接。 */
export class LedgerDatabase {
  private readonly queue = new SerialQueue()
  private connection?: NativeDatabase
  private ready = false
  private claimed = false

  constructor(
    readonly name = 'ledger',
    private readonly chain: readonly Migration[] = migrations,
    private readonly seed: Seed = defaultSeed,
    private readonly files: LedgerFiles = ledgerFiles,
    private readonly observe: LifecycleObserver = async () => {},
  ) {}

  open(): Promise<void> {
    return this.queue.run(async () => {
      if (this.ready) {
        return
      }
      if (owners.has(this.name) && !this.claimed) {
        throw new LocalError('DATABASE_BUSY', '账本已由另一入口打开。')
      }
      // 上次关闭失败的句柄仍归本入口；清理成功前不能覆盖引用或创建同名连接。
      if (this.claimed) {
        await this.closeNativeConnection()
      }
      owners.add(this.name)
      this.claimed = true
      try {
        if (!this.chain.length || this.chain.some((m, i) => m.version !== i + 1)) {
          this.refuse('迁移版本不连续。')
        }
        this.connection = await createIosDatabase(this.name, 1)
        await this.connection.open()
        await this.verifyForeignKeys()
        const tables = await this.connection.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        if (!tables.values?.length) {
          await this.initialize()
        } else {
          await this.upgrade()
        }
        const flags = await this.files.protect({ name: this.name })
        if (!flags.excluded || (!flags.protected && !flags.simulator)) {
          this.refuse('账本文件保护未生效。')
        }
        this.ready = true
      } catch (error) {
        await this.release(error)
        throw error
      }
    })
  }

  close(): Promise<void> {
    return this.queue.run(async () => {
      this.ready = false
      await this.release()
    })
  }

  read<T>(task: (sql: SqlSession) => Promise<T>, signal?: AbortSignal): Promise<T> {
    // 读入口仍仅面向数据层仓储；不把原始 SQL 暴露给页面。
    return this.queue.run(async () => {
      this.requireReady()
      return task(this.session())
    }, signal)
  }

  write<T>(task: (sql: SqlSession) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.queue.run(async () => {
      this.requireReady()
      return this.transaction(() => task(this.session()), signal)
    }, signal)
  }

  /** 操作名+ID 范围去重；digest 由应用层对规范化业务输入计算。记录与写入同事务。 */
  executeOnce<T>(operation: string, id: string, digest: string, task: (sql: SqlSession) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!/^[a-z][a-z0-9_.]{0,63}$/.test(operation) || !id || id.length > 128 || !/^[a-f0-9]{64}$/.test(digest)) {
      return Promise.reject(new LocalError('INVALID_OPERATION', '操作标识不合法。'))
    }
    return this.write(async (sql) => {
      const old = (await sql.query('SELECT request_digest,result_json FROM idempotency_result WHERE operation=? AND operation_id=?', [operation, id]))[0]
      if (old) {
        if (old.request_digest !== digest) {
          throw new LocalError('IDEMPOTENCY_CONFLICT', '相同操作标识对应的内容不一致。')
        }
        return JSON.parse(old.result_json as string) as T
      }
      const result = await task(sql)
      const encoded = JSON.stringify(result)
      if (encoded === undefined) {
        throw new TypeError('幂等结果必须可序列化。')
      }
      await sql.run('INSERT INTO idempotency_result VALUES(?,?,?,?,?)', [operation, id, digest, encoded, new Date().toISOString()])
      return result
    }, signal)
  }

  private session(): SqlSession {
    const connection = this.connection!
    return {
      query: async (sql, values = []) => (await connection.query(sql, values)).values ?? [],
      run: async (sql, values = []) => (await connection.run(sql, values, false)).changes?.changes ?? 0,
    }
  }

  private async initialize() {
    await this.transaction(async () => {
      for (const migration of this.chain) {
        await this.apply(migration)
      }
      for (const item of this.seed.items) {
        await this.session().run(`INSERT INTO dictionary_item
          (id,kind,name,normalized_name,sort_order,seed_key,seed_version,status) VALUES(?,?,?,?,?,?,?,'ACTIVE')`, seedValues(item, this.seed.version))
      }
      for (const [key, value] of Object.entries(this.seed.preferences)) {
        // 仅新数据集：新版 seed 决定初始偏好，覆盖迁移中为存量缺失字段提供的缺省值。
        await this.session().run('INSERT INTO preference VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, JSON.stringify(value)])
      }
      const now = new Date().toISOString()
      await this.session().run('INSERT INTO ledger_meta VALUES(1,?,?,1,?,?,?)',
        [this.chain.length, crypto.randomUUID(), this.seed.version, now, now])
      await this.integrity(this.chain.length)
    })
  }

  private async upgrade() {
    let meta: Record<string, unknown> | undefined
    try {
      meta = (await this.session().query('SELECT * FROM ledger_meta WHERE singleton=1'))[0]
    } catch (cause) {
      throw new LocalError('DATABASE_INCOMPATIBLE', '账本元信息缺失，请使用兼容版本或备份恢复。', { cause })
    }
    if (!meta || meta.initialized !== 1 || !Number.isSafeInteger(meta.schema_version) || (meta.schema_version as number) < 1 ||
      (meta.schema_version as number) > this.chain.length || typeof meta.dataset_id !== 'string' || !meta.dataset_id ||
      !Number.isSafeInteger(meta.seed_version)) {
      this.refuse('账本版本或初始化状态不兼容。')
    }
    const version = meta.schema_version as number
    const history = await this.session().query('SELECT version,digest FROM migration_history ORDER BY version')
    if (history.length !== version) {
      this.refuse('迁移履历不完整。')
    }
    for (let i = 0; i < version; i++) {
      if (history[i].version !== i + 1 || history[i].digest !== await sha256(this.chain[i].sql)) {
        this.refuse('迁移摘要与历史不一致。')
      }
    }
    await this.integrity(version)
    if (version === this.chain.length) {
      return
    }
    // DELETE journal 模式关闭后没有待合并 WAL；复制在独占生命周期队列内执行。
    await this.closeNativeConnection()
    const snapshot = await this.files.snapshot({ name: this.name })
    if (!snapshot.excluded || (!snapshot.protected && !snapshot.simulator) || !snapshot.sha256) {
      this.refuse('升级保护快照不可用。')
    }
    await this.observe('snapshot-ready', version)
    this.connection = await createIosDatabase(this.name, 1)
    await this.connection.open()
    await this.verifyForeignKeys()
    await this.transaction(async () => {
      for (const migration of this.chain.slice(version)) {
        await this.apply(migration)
      }
      await this.session().run('UPDATE ledger_meta SET schema_version=? WHERE singleton=1', [this.chain.length])
      await this.integrity(this.chain.length)
    })
    await this.observe('upgrade-committed', this.chain.length)
  }

  private async apply(migration: Migration) {
    await this.connection!.execute(migration.sql, false)
    await this.session().run('INSERT INTO migration_history VALUES(?,?,?)', [migration.version, await sha256(migration.sql), new Date().toISOString()])
    await this.observe('migration-recorded', migration.version)
  }

  private async transaction<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const db = this.connection!
    await db.beginTransaction()
    try {
      const result = await task()
      throwIfCancelled(signal)
      await db.commitTransaction()
      return result
    } catch (error) {
      try {
        if ((await db.isTransactionActive()).result) {
          await db.rollbackTransaction()
        }
      } catch (rollback) {
        this.ready = false
        throw new AggregateError([error, rollback], '事务失败且回滚失败，停止账本写入。')
      }
      throw error
    }
  }

  private async verifyForeignKeys() {
    await this.connection!.execute('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;', false)
    if ((await this.session().query('PRAGMA foreign_keys'))[0]?.foreign_keys !== 1) {
      this.refuse('外键未开启。')
    }
  }

  private async integrity(version: number) {
    const actual = await this.session().query("SELECT type,name,tbl_name AS tableName,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name")
    assertSchema(actual as SchemaObject[], this.chain[version - 1].schema)
    if ((await this.session().query('PRAGMA quick_check'))[0]?.quick_check !== 'ok' ||
      (await this.session().query('PRAGMA foreign_key_check')).length) {
      this.refuse('账本完整性检查失败。')
    }
  }

  private requireReady() {
    if (!this.ready) {
      throw new LocalError('DATABASE_NOT_READY', '账本尚未就绪。')
    }
  }

  private refuse(message: string): never {
    throw new LocalError('DATABASE_INCOMPATIBLE', message)
  }

  /** 清理句柄时不交出所有权；重开和升级在 await 边界仍须拒绝其他入口。 */
  private async closeNativeConnection(primaryError?: unknown) {
    try {
      if (this.connection) {
        await nativeSqlite.closeConnection(this.name, false)
      }
    } catch (close) {
      // 原生关闭失败时仍持有句柄/所有权，允许 close 或 open 在同一队列中重试。
      throw new AggregateError(primaryError !== undefined ? [primaryError, close] : [close], '账本连接释放失败。')
    }
    this.connection = undefined
  }

  private async release(primaryError?: unknown) {
    await this.closeNativeConnection(primaryError)
    if (this.claimed) {
      owners.delete(this.name)
    }
    this.claimed = false
  }
}
