import { Capacitor } from '@capacitor/core'
import { nativeSqlite, openIosDatabase } from '../src/infrastructure/database/nativeConnection'
// App 与保留的旧 Web 均消费同一金额实现。
import { calculateExpenseTotal, decimalToScaledInteger, fromSqliteInteger, toSqliteInteger, SQLITE_INTEGER_MAX } from '../src/domain/money'

function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** 通过真实 WKWebView → Capacitor → iOS SQLite 桥执行；只操作本轮随机实验库。 */
export async function run() {
  const started = performance.now()
  const name = `probe_${crypto.randomUUID().replaceAll('-', '')}`
  let database = await openIosDatabase(name, 1)
  let primaryError: unknown
  try {
    // INTEGER 使用十进制字符串绑定/读取，跨桥不经过 JavaScript Number。
    await database.execute(`CREATE TABLE probe (
      id TEXT PRIMARY KEY NOT NULL,
      cents INTEGER NOT NULL CHECK(typeof(cents) = 'integer'),
      note TEXT NOT NULL
    );`)
    const cents = toSqliteInteger(9007199254740993n)
    const note = "绑定样本 '); DROP TABLE probe; --"
    const total = calculateExpenseTotal('12.3456', '1.250')
    requireValue(total === '15.43', '金额舍入口径改变')
    await database.beginTransaction()
    await database.run('INSERT INTO probe(id,cents,note) VALUES(?,?,?)',
      ['committed', cents, note], false)
    await database.run('INSERT INTO probe(id,cents,note) VALUES(?,?,?)',
      ['money', decimalToScaledInteger(total, 2).toString(), '15.43'], false)
    await database.commitTransaction()

    // 唯一约束失败后显式回滚，检查前一条写入也不留下残留。
    await database.beginTransaction()
    let rejected = false
    try {
      await database.run('INSERT INTO probe(id,cents,note) VALUES(?,?,?)', ['rolled_back', '1', 'rollback'], false)
      await database.run('INSERT INTO probe(id,cents,note) VALUES(?,?,?)', ['committed', '2', 'duplicate'], false)
    } catch (error) {
      rejected = error instanceof Error && error.message.includes('UNIQUE constraint failed: probe.id')
    } finally {
      if ((await database.isTransactionActive()).result) await database.rollbackTransaction()
    }
    requireValue(rejected, '重复主键未被拒绝')
    await nativeSqlite.closeConnection(name, false)
    database = await openIosDatabase(name, 1)
    const rows = (await database.query(
      'SELECT id,CAST(cents AS TEXT) AS cents,note,typeof(cents) AS storage FROM probe ORDER BY id',
    )).values
    requireValue(rows?.length === 2, '提交或回滚结果错误')
    requireValue(rows[0]?.cents === cents && rows[0]?.note === note && rows[0]?.storage === 'integer',
      '大整数或参数绑定未精确持久化')
    requireValue(rows[1]?.cents === '1543', '金额重开后不一致')
    requireValue(fromSqliteInteger(rows[0]?.cents) === 9007199254740993n, '领域读取边界丢失精度')
    const sum = (await database.query('SELECT CAST(SUM(cents) AS TEXT) AS total FROM probe')).values?.[0]?.total
    requireValue(sum === '9007199254742536', '超过 JS 安全整数的聚合丢失精度')
    // SQLite 自身的 64 位 SUM 溢出也必须拒绝，不能转成 REAL 或返回空成功。
    await database.run('INSERT INTO probe(id,cents,note) VALUES(?,?,?)',
      ['overflow', toSqliteInteger(SQLITE_INTEGER_MAX), 'overflow fixture'])
    let overflowRejected = false
    try {
      await database.query('SELECT CAST(SUM(cents) AS TEXT) AS total FROM probe')
    } catch (error) {
      overflowRejected = error instanceof Error && error.message.toLowerCase().includes('integer overflow')
    }
    requireValue(overflowRejected, 'SQLite 聚合溢出未明确拒绝')
    await database.run('DELETE FROM probe WHERE id = ?', ['overflow'])
    requireValue((await database.query('SELECT COUNT(*) AS count FROM probe')).values?.[0]?.count === 2,
      '溢出样本删除影响了已提交记录')
    await nativeSqlite.closeConnection(name, false)

    // 插件最小原生升级实验；不替代 T3 的迁移历史/保护快照实现。
    await nativeSqlite.addUpgradeStatement(name, [{ toVersion: 2, statements: [
      'ALTER TABLE probe ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;',
    ] }])
    database = await openIosDatabase(name, 2)
    const upgraded = (await database.query(
      'SELECT CAST(cents AS TEXT) AS cents,revision FROM probe WHERE id = ?', ['committed'],
    )).values?.[0]
    requireValue(upgraded?.cents === cents && upgraded?.revision === 1, '升级破坏原值或默认值')
    const version = (await database.getVersion()).version
    requireValue(version === 2, '升级版本未持久化')
    return { platform: Capacitor.getPlatform(), cents, sum, total, version, rows: rows.length,
      durationMs: Math.round(performance.now() - started) }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    // 删除仅归本轮所有的实验库；正式账本永远不使用 probe_ 前缀。
    try {
      // 打开/升级失败时注册表可能已释放连接，创建未打开的清理句柄即可删本轮库。
      const cleanupConnection = (await nativeSqlite.isConnection(name, false)).result
        ? await nativeSqlite.retrieveConnection(name, false)
        : await nativeSqlite.createConnection(name, false, 'no-encryption', 1, false)
      try {
        await cleanupConnection.delete()
      } finally {
        await nativeSqlite.closeConnection(name, false)
      }
    } catch (cleanupError) {
      if (primaryError) throw new AggregateError([primaryError, cleanupError], '探针失败且实验库清理失败。')
      throw cleanupError
    }
  }
}

export { lifecycle, prepareCrash, recoverCrash } from './lifecycleProbe'
export { shell } from './shellProbe'

export { dictionaries } from './dictionaryProbe'
export { dictionaryUi } from './dictionaryUiProbe'
export { entries } from './entryProbe'
export { personal } from './personalProbe'
export { adjustments } from './adjustmentProbe'
export { cleanupFinalization } from './adjustmentProbe'
export { cleanupForegroundState } from './adjustmentProbe'
