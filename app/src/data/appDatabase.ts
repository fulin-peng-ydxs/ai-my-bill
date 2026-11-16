import { LedgerDatabase } from './ledgerDatabase'

/** 启动与本地服务共用唯一账本所有者；页面只消费应用服务，不取得连接或 SQL 会话。 */
export const appDatabase = new LedgerDatabase()
