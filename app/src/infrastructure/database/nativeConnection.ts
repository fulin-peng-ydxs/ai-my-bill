import { Capacitor } from '@capacitor/core'
import { nativeSqlite } from './nativeAdapter'
export { nativeSqlite } from './nativeAdapter'

/** 创建并登记原生连接；调用方先接管句柄，再打开，以便失败时仍能重试释放。 */
export async function createIosDatabase(name: string, version: number) {
  if (Capacitor.getPlatform() !== 'ios' || !Capacitor.isPluginAvailable('CapacitorSQLite')) {
    throw new Error('本地账本仅支持已安装 SQLite 插件的 iPhone App。')
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name) || !Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('数据库标识或版本不合法。')
  }
  return nativeSqlite.createConnection(name, false, 'no-encryption', version, false)
}

/** 独立原生探针的打开入口；正式账本由 LedgerDatabase 管理完整生命周期。 */
export async function openIosDatabase(name: string, version: number) {
  const database = await createIosDatabase(name, version)
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
