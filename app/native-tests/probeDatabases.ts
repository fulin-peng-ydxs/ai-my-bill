import { LedgerDatabase } from '../src/data/ledgerDatabase'
import { migrations, type Migration } from '../src/data/migrations'
import { nativeSqlite } from '../src/infrastructure/database/nativeConnection'

/** 原生业务探针共用随机库所有权与清理；只回收自身名称，不触碰正式账本。 */
export async function withProbeDatabases<T>(label: string, run: (manager: (suffix: string, chain?: readonly Migration[]) => LedgerDatabase, prefix: string) => Promise<T>) {
  const prefix = `probe_${label}_${crypto.randomUUID().replaceAll('-', '')}`
  const managers: LedgerDatabase[] = []
  const names = new Set<string>()
  const manager = (suffix: string, chain: readonly Migration[] = migrations) => {
    const name = `${prefix}_${suffix}`
    names.add(name)
    const database = new LedgerDatabase(name, chain)
    managers.push(database)
    return database
  }
  try {
    return await run(manager, prefix)
  } finally {
    for (const database of managers) {
      await database.close()
    }
    for (const name of names) {
      const cleanup = await nativeSqlite.createConnection(name, false, 'no-encryption', 1, false)
      try {
        await cleanup.delete()
      } finally {
        await nativeSqlite.closeConnection(name, false)
      }
    }
  }
}
