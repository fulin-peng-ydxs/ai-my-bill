import { registerPlugin } from '@capacitor/core'
import type { CapacitorSQLitePlugin, capSQLiteValues } from '@capacitor-community/sqlite'

// 只注册原生桥，不注册 Web 实现或打包 Web 数据库。锁定插件仍负责所有 SQLite 操作。
const sqlite = registerPlugin<CapacitorSQLitePlugin>('CapacitorSQLite')
function rows(result: capSQLiteValues): capSQLiteValues {
  const values = result.values ?? []
  const columns: unknown = values[0]?.ios_columns
  // 原生 NSDictionary 不保证属性序；沿用锁定插件按 ios_columns 恢复 SELECT 列序的协议。
  if (!Array.isArray(columns)) {
    return { ...result, values }
  }
  return {
    ...result,
    values: values.slice(1).map(row => Object.fromEntries(
      columns.map(column => [String(column), row[String(column)]]),
    )),
  }
}

export class NativeDatabase {
  constructor(private readonly database: string) {}

  open() {
    return sqlite.open({ database: this.database, readonly: false })
  }

  execute(statements: string, transaction = true) {
    return sqlite.execute({
      database: this.database,
      statements,
      transaction,
      readonly: false,
      isSQL92: true,
    })
  }

  async run(statement: string, values: (string | number | null)[] = [], transaction = true) {
    return sqlite.run({
      database: this.database,
      statement,
      values,
      transaction,
      readonly: false,
      returnMode: 'no',
      isSQL92: true,
    })
  }

  async query(statement: string, values: (string | number | null)[] = []) {
    return rows(await sqlite.query({
      database: this.database,
      statement,
      values,
      readonly: false,
      isSQL92: true,
    }))
  }

  beginTransaction() {
    return sqlite.beginTransaction({ database: this.database })
  }

  commitTransaction() {
    return sqlite.commitTransaction({ database: this.database })
  }

  rollbackTransaction() {
    return sqlite.rollbackTransaction({ database: this.database })
  }

  isTransactionActive() {
    return sqlite.isTransactionActive({ database: this.database })
  }

  getVersion() {
    return sqlite.getVersion({ database: this.database, readonly: false })
  }

  delete() {
    return sqlite.deleteDatabase({ database: this.database, readonly: false })
  }
}

const connections = new Map<string, NativeDatabase>()
export const nativeSqlite = {
  async createConnection(name: string, encrypted: boolean, mode: string, version: number, readonly: boolean) {
    if (encrypted || readonly || mode !== 'no-encryption') {
      throw new Error('当前账本连接配置不支持。')
    }
    await sqlite.createConnection({ database: name, encrypted, mode, version, readonly })
    const db = new NativeDatabase(name)
    connections.set(name, db)
    return db
  },
  async closeConnection(name: string, readonly: boolean) {
    await sqlite.closeConnection({ database: name, readonly })
    connections.delete(name)
  },
  async isConnection(name: string, _readonly: boolean) {
    return { result: connections.has(name) }
  },
  async retrieveConnection(name: string, _readonly: boolean) {
    const db = connections.get(name)
    if (!db) {
      throw new Error('连接不存在。')
    }
    return db
  },
  async addUpgradeStatement(name: string, upgrade: { toVersion: number; statements: string[] }[]) {
    return sqlite.addUpgradeStatement({ database: name, upgrade })
  },
}
