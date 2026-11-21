import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

/** Node 单测专用的真实 SQLite 桥替身。生产依赖图不导入此文件；原生桥/文件保护仍由模拟器验证。 */
export function createSqliteBridge() {
  const base = fileURLToPath(new URL('../../.local/ios/tmp/ai-agent/', import.meta.url))
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const directory = mkdtempSync(join(base, 'dictionary-unit-'))
  const connections = new Map<string, DatabaseSync>()
  const filename = (name: string) => join(directory, `${name}SQLite.db`)
  function connection(name: string) {
    const database = connections.get(name)
    if (!database) {
      throw new Error('受控连接不存在')
    }
    return database
  }
  const sqlite = {
    async createConnection({ database }: { database: string }) {
      if (connections.has(database)) {
        throw new Error('受控连接已存在')
      }
      connections.set(database, new DatabaseSync(filename(database)))
    },
    async open() {},
    async closeConnection({ database }: { database: string }) {
      connections.get(database)?.close()
      connections.delete(database)
    },
    async execute({ database, statements }: { database: string; statements: string }) {
      connection(database).exec(statements)
      return { changes: { changes: 0 } }
    },
    async query({ database, statement, values = [] }: { database: string; statement: string; values?: (string | number | null)[] }) {
      return { values: connection(database).prepare(statement).all(...values) }
    },
    async run({ database, statement, values = [] }: { database: string; statement: string; values?: (string | number | null)[] }) {
      return { changes: { changes: Number(connection(database).prepare(statement).run(...values).changes) } }
    },
    async beginTransaction({ database }: { database: string }) {
      connection(database).exec('BEGIN TRANSACTION')
    },
    async commitTransaction({ database }: { database: string }) {
      connection(database).exec('COMMIT')
    },
    async rollbackTransaction({ database }: { database: string }) {
      connection(database).exec('ROLLBACK')
    },
    async isTransactionActive({ database }: { database: string }) {
      return { result: connection(database).isTransaction }
    },
    async deleteDatabase({ database }: { database: string }) {
      connections.get(database)?.close()
      connections.delete(database)
      unlinkSync(filename(database))
    },
  }
  const files = {
    async protect() {
      return { excluded: true, protected: false, simulator: true }
    },
    async snapshot({ name }: { name: string }) {
      if (connections.has(name)) {
        throw new Error('快照前未关闭数据库')
      }
      const id = `snapshot_${crypto.randomUUID()}`
      copyFileSync(filename(name), join(directory, id))
      const bytes = readFileSync(filename(name))
      return { id, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), excluded: true, protected: false, simulator: true }
    },
  }
  return {
    sqlite,
    files,
    /** 只读查询剖析使用本轮真实 SQLite 文件；仍由 dispose 统一回收。 */
    databasePath(name: string) {
      connection(name)
      return filename(name)
    },
    dispose() {
      for (const database of connections.values()) {
        database.close()
      }
      connections.clear()
      rmSync(directory, { recursive: true })
    },
  }
}
