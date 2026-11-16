import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  createConnection: vi.fn(),
  open: vi.fn(),
  closeConnection: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'ios', isPluginAvailable: () => true },
  registerPlugin: () => bridge,
}))

import { nativeSqlite } from '../infrastructure/database/nativeConnection'
import type { LedgerFiles } from '../platform/ledgerFiles'
import { LedgerDatabase } from './ledgerDatabase'
import { migrations, sha256 } from './migrations'

// 只替换原生桥的连接故障，不替换生命周期、所有权、队列及 schema/履历校验。
// 真实 SQL 的提交/回滚和持久化由同一生产入口的模拟器 hosted XCTest 覆盖。
const nativeConnections = new Set<string>()
const managers: LedgerDatabase[] = []
let nextName = 0
let digest: string
let files: LedgerFiles

function manager(name = `close_retry_${++nextName}`) {
  const database = new LedgerDatabase(name, undefined, undefined, files)
  managers.push(database)
  return database
}

beforeEach(async () => {
  vi.resetAllMocks()
  digest = await sha256(migrations[0].sql)
  bridge.createConnection.mockImplementation(async ({ database }: { database: string }) => {
    if (nativeConnections.has(database)) {
      throw new Error('Connection already exists')
    }
    nativeConnections.add(database)
  })
  bridge.closeConnection.mockImplementation(async ({ database }: { database: string }) => {
    nativeConnections.delete(database)
  })
  bridge.query.mockImplementation(async ({ statement }: { statement: string }) => {
    if (statement === 'PRAGMA foreign_keys') {
      return { values: [{ foreign_keys: 1 }] }
    }
    if (statement.startsWith('SELECT name FROM sqlite_master')) {
      return { values: [{ name: 'ledger_meta' }] }
    }
    if (statement.startsWith('SELECT * FROM ledger_meta')) {
      return { values: [{ initialized: 1, schema_version: 1, dataset_id: 'controlled-dataset', seed_version: 1 }] }
    }
    if (statement.startsWith('SELECT version,digest FROM migration_history')) {
      return { values: [{ version: 1, digest }] }
    }
    if (statement.startsWith('SELECT type,name,tbl_name')) {
      return { values: migrations[0].schema }
    }
    if (statement === 'PRAGMA quick_check') {
      return { values: [{ quick_check: 'ok' }] }
    }
    if (statement === 'PRAGMA foreign_key_check') {
      return { values: [] }
    }
    if (statement === 'SELECT dataset_id FROM ledger_meta') {
      return { values: [{ dataset_id: 'controlled-dataset' }] }
    }
    throw new Error(`未声明的受控查询：${statement}`)
  })
  files = {
    protect: vi.fn().mockResolvedValue({ excluded: true, protected: false, simulator: true }),
    snapshot: vi.fn(),
  }
})

afterEach(async () => {
  // 失败断言也清理本用例连接；不访问磁盘或其他测试的数据库。
  await Promise.allSettled(managers.splice(0).map(database => database.close()))
  for (const name of nativeConnections) {
    await nativeSqlite.closeConnection(name, false)
  }
})

describe('账本关闭失败后的所有权与重试', () => {
  it('关闭失败后禁止读写并保留所有权，再次关闭成功后可重开及交接', async () => {
    const database = manager()
    const competing = manager(database.name)
    await database.open()
    bridge.closeConnection.mockRejectedValueOnce(new Error('controlled-close-failure'))

    await expect(database.close()).rejects.toThrow('账本连接释放失败')
    await expect(database.read(async () => '不应执行')).rejects.toMatchObject({ code: 'DATABASE_NOT_READY' })
    await expect(database.write(async () => '不应执行')).rejects.toMatchObject({ code: 'DATABASE_NOT_READY' })
    await expect(competing.open()).rejects.toMatchObject({ code: 'DATABASE_BUSY' })
    expect(await nativeSqlite.isConnection(database.name, false)).toEqual({ result: true })

    await database.close()
    expect(bridge.closeConnection).toHaveBeenCalledTimes(2)
    expect(await nativeSqlite.isConnection(database.name, false)).toEqual({ result: false })
    await database.open()
    expect(await database.read(async sql => (await sql.query('SELECT dataset_id FROM ledger_meta'))[0].dataset_id))
      .toBe('controlled-dataset')
    await database.close()
    await competing.open()
  })

  it('直接重开先重试遗留关闭；持续关闭失败时不创建新连接，之后可恢复', async () => {
    const database = manager()
    await database.open()
    bridge.closeConnection
      .mockRejectedValueOnce(new Error('controlled-close-failure-1'))
      .mockRejectedValueOnce(new Error('controlled-close-failure-2'))

    await expect(database.close()).rejects.toThrow('账本连接释放失败')
    await expect(database.open()).rejects.toThrow('账本连接释放失败')
    expect(bridge.createConnection).toHaveBeenCalledTimes(1)
    await expect(manager(database.name).open()).rejects.toMatchObject({ code: 'DATABASE_BUSY' })

    await database.open()
    expect(bridge.closeConnection).toHaveBeenCalledTimes(3)
    expect(bridge.createConnection).toHaveBeenCalledTimes(2)
    await expect(database.read(async () => 'ready')).resolves.toBe('ready')
  })

  it('初始化检查与关闭同时失败时保留两个原因，可关闭后重新校验', async () => {
    const database = manager()
    const primary = new Error('controlled-protection-failure')
    const close = new Error('controlled-close-failure')
    vi.mocked(files.protect).mockRejectedValueOnce(primary)
    bridge.closeConnection.mockRejectedValueOnce(close)

    await expect(database.open()).rejects.toMatchObject({ errors: [primary, close] })
    await expect(manager(database.name).open()).rejects.toMatchObject({ code: 'DATABASE_BUSY' })
    await database.close()
    await database.open()
    expect(files.protect).toHaveBeenCalledTimes(2)
  })

  it('重开清理等待期间保持独占，同一入口的并发重开只创建一次新连接', async () => {
    const database = manager()
    await database.open()
    bridge.closeConnection.mockRejectedValueOnce(new Error('controlled-close-failure'))
    await expect(database.close()).rejects.toThrow('账本连接释放失败')

    let finish!: () => void
    const waiting = new Promise<void>(resolve => {
      finish = resolve
    })
    bridge.closeConnection.mockImplementationOnce(async ({ database: name }: { database: string }) => {
      await waiting
      nativeConnections.delete(name)
    })
    const reopening = database.open()
    const repeated = database.open()
    try {
      await expect(manager(database.name).open()).rejects.toMatchObject({ code: 'DATABASE_BUSY' })
      expect(bridge.createConnection).toHaveBeenCalledTimes(1)
    } finally {
      finish()
    }
    await Promise.all([reopening, repeated])
    expect(bridge.closeConnection).toHaveBeenCalledTimes(2)
    expect(bridge.createConnection).toHaveBeenCalledTimes(2)
    await expect(database.read(async () => 'ready')).resolves.toBe('ready')
  })

  it('原生打开与清理同时失败时仍有账本所有者，可以直接重开恢复', async () => {
    const database = manager()
    const primary = new Error('controlled-open-failure')
    const close = new Error('controlled-close-failure')
    bridge.open.mockRejectedValueOnce(primary)
    bridge.closeConnection.mockRejectedValueOnce(close)

    await expect(database.open()).rejects.toMatchObject({ errors: [primary, close] })
    await expect(manager(database.name).open()).rejects.toMatchObject({ code: 'DATABASE_BUSY' })
    await database.open()
    expect(bridge.closeConnection).toHaveBeenCalledTimes(2)
    expect(bridge.createConnection).toHaveBeenCalledTimes(2)
    await expect(database.read(async () => 'ready')).resolves.toBe('ready')
  })
})
