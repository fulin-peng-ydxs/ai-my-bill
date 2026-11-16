import { Capacitor } from '@capacitor/core'
import { nativeSqlite } from './nativeAdapter'
export { nativeSqlite } from './nativeAdapter'

/** 最小原生连接边界；账本版本、快照与并发生命周期由 LedgerDatabase 管理。 */
export async function openIosDatabase(name: string, version: number) {
  if (Capacitor.getPlatform() !== 'ios' || !Capacitor.isPluginAvailable('CapacitorSQLite')) {
    throw new Error('本地账本仅支持已安装 SQLite 插件的 iPhone App。')
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name) || !Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('数据库标识或版本不合法。')
  }
  const database = await nativeSqlite.createConnection(name, false, 'no-encryption', version, false)
  try {
    await database.open()
  } catch (error) {
    try {
      await nativeSqlite.closeConnection(name, false)
    } catch (closeError) {
      throw new AggregateError([error, closeError], '数据库打开失败，连接释放也失败。')
    }
    throw error
  }
  return database
}
