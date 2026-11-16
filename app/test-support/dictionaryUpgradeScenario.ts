import { LedgerDatabase } from '../src/data/ledgerDatabase'
import { migrations, type Migration } from '../src/data/migrations'
import type { Seed } from '../src/data/seed/defaults'
import { DictionaryService } from '../src/data/dictionaries/dictionaryService'
import { check, rejected } from './dictionaryScenarios'

export const seedCashId = '71000000-0000-0000-0000-000000000001'
const deletedId = '71000000-0000-0000-0000-000000000002'
const productId = '71000000-0000-0000-0000-000000000003'
const customId = '71000000-0000-0000-0000-000000000004'
const recommendationId = '71000000-0000-0000-0000-000000000005'
const requiredId = '71000000-0000-0000-0000-000000000006'
export const dictionarySeedA: Seed = {
  version: 11,
  items: [
    { id: seedCashId, kind: 'FUNDING_CHANNEL', name: '现金', key: 'cash', order: 10 },
    { id: deletedId, kind: 'UNIT', name: '允许删除的默认单位', key: 'default_unit', order: 10 },
    { id: productId, kind: 'PRODUCT', name: '旧版商品', key: 'old_product', order: 10 },
  ],
  preferences: { enabled: false, count: 0, empty: '', defaultFundingChannelId: null },
}
export const dictionarySeedB: Seed = {
  version: 12,
  items: [
    { ...dictionarySeedA.items[0], name: '现金钱包', order: 99 },
    dictionarySeedA.items[1],
    { id: recommendationId, kind: 'FUNDING_CHANNEL', name: '新推荐项', key: 'recommendation', order: 20 },
  ],
  preferences: { enabled: true, count: 1, empty: '新默认', defaultFundingChannelId: null },
}

type Factory = (suffix: string, chain?: readonly Migration[], seed?: Seed) => LedgerDatabase

/** 真正的 v1→当前升级与定义为拒绝冲突的受控数据迁移；不读取或迁移旧 Web 账本。 */
export async function dictionaryUpgradeScenario(factory: Factory) {
  const managers: LedgerDatabase[] = []
  function manager(suffix: string, chain = migrations, seed = dictionarySeedB) {
    const database = factory(suffix, chain, seed)
    managers.push(database)
    return database
  }
  try {
    const old = manager('old', [migrations[0]], dictionarySeedA)
    await old.open()
    const dataset = await old.read(async sql => (await sql.query('SELECT dataset_id FROM ledger_meta'))[0].dataset_id)
    await old.write(async sql => {
      await sql.run("UPDATE dictionary_item SET name='零钱',normalized_name='零钱',sort_order=77,status='INACTIVE',row_version=2 WHERE id=?", [seedCashId])
      await sql.run('DELETE FROM dictionary_item WHERE id=?', [deletedId])
      await sql.run("INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES(?,'PAYER','自定义付款方','自定义付款方','ACTIVE')", [customId])
      await sql.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date)
        VALUES(?,'EXPENSE',?,?,'现金','2026-11-15T01:00:00.000Z','2026-11-15')`, [crypto.randomUUID(), '1543', seedCashId])
    })
    await old.close()
    const upgraded = manager('old')
    await upgraded.open()
    const service = new DictionaryService(upgraded)
    const cash = await service.get('funding-channel', seedCashId)
    check(cash.name === '零钱' && cash.status === 'INACTIVE' && cash.sortOrder === 77 && cash.referenced, '升级覆盖用户名称、顺序、停用或引用')
    await rejected(() => service.get('unit', deletedId), 'DICTIONARY_ITEM_NOT_FOUND')
    check((await service.list('funding-channel')).items.every(row => row.id !== recommendationId), '新版推荐项被自动灌入已有账本')
    check((await service.get('payer', customId)).name === '自定义付款方', '升级删除自定义项')
    check((await service.get('product', productId)).id === productId, '旧商品未以原 ID 补齐治理结构')
    const meta = await upgraded.read(async sql => (await sql.query('SELECT * FROM ledger_meta'))[0])
    check(meta.dataset_id === dataset && meta.seed_version === 11 && meta.schema_version === migrations.length, '升级更换数据集或初始化来源')
    const preferences = await upgraded.read(sql => sql.query('SELECT key,value FROM preference ORDER BY key'))
    check(preferences.some(row => row.key === 'enabled' && row.value === 'false') && preferences.some(row => row.key === 'count' && row.value === '0') && preferences.some(row => row.key === 'empty' && row.value === '""'), '升级覆盖 false/0/空值')
    const history = await upgraded.read(sql => sql.query('SELECT funding_channel_name_snapshot,product_id,CAST(amount_cents AS TEXT) AS cents FROM ledger_entry'))
    check(history[0].funding_channel_name_snapshot === '现金' && history[0].product_id === null && history[0].cents === '1543', '升级猜测旧记录归属或覆盖历史快照/金额')
    await upgraded.close()

    const fresh = manager('fresh')
    await fresh.open()
    check((await new DictionaryService(fresh).get('funding-channel', seedCashId)).name === '现金钱包', '新账本未采用当前 seed')
    check((await new DictionaryService(fresh).get('funding-channel', recommendationId)).name === '新推荐项', '新账本推荐项缺失')
    await fresh.close()

    const nextVersion = migrations.length + 1
    for (const conflict of ['name', 'stable-key']) {
      const insert = conflict === 'name'
        ? `INSERT INTO dictionary_item(id,kind,name,normalized_name,status,seed_key) VALUES('${requiredId}','FUNDING_CHANNEL','零钱','零钱','ACTIVE','required')`
        : `INSERT INTO dictionary_item(id,kind,name,normalized_name,status,seed_key) VALUES('${requiredId}','FUNDING_CHANNEL','必需项','必需项','ACTIVE','cash')`
      const migration: Migration = {
        version: nextVersion,
        schema: migrations.at(-1)!.schema,
        sql: `INSERT INTO preference VALUES('required_marker','true'); ${insert};`,
      }
      const rejectedUpgrade = manager('old', [...migrations, migration])
      await rejected(() => rejectedUpgrade.open())
      await rejected(() => rejectedUpgrade.open())
      const reopened = manager('old')
      await reopened.open()
      check(await reopened.read(async sql => (await sql.query("SELECT * FROM preference WHERE key='required_marker'")).length) === 0, '冲突迁移留下部分数据')
      check(await reopened.read(async sql => (await sql.query('SELECT * FROM migration_history')).length) === migrations.length, '冲突迁移写入成功履历')
      check((await new DictionaryService(reopened).get('funding-channel', seedCashId)).name === '零钱', '冲突迁移覆盖用户项')
      await reopened.close()
    }
    // 成功的必需迁移使用独立稳定键，不猜测替换用户项；再次打开由履历保证只执行一次。
    const required: Migration = {
      version: nextVersion,
      schema: migrations.at(-1)!.schema,
      sql: `INSERT INTO preference VALUES('required_marker','true');
        INSERT INTO dictionary_item(id,kind,name,normalized_name,status,seed_key) VALUES('${requiredId}','FUNDING_CHANNEL','必需项','必需项','ACTIVE','required');`,
    }
    const accepted = manager('old', [...migrations, required])
    await accepted.open()
    await accepted.close()
    await accepted.open()
    check(await accepted.read(async sql => (await sql.query('SELECT * FROM dictionary_item WHERE id=?', [requiredId])).length) === 1, '必需迁移重跑重复插入')
    check(await accepted.read(async sql => (await sql.query('SELECT * FROM migration_history')).length) === nextVersion, '迁移履历重复或缺失')
    await accepted.close()
    await rejected(() => manager('old').open(), 'DATABASE_INCOMPATIBLE')
    return 'v1-upgrade-seed-protection-and-required-data-conflicts'
  } finally {
    const results = await Promise.allSettled(managers.map(database => database.close()))
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length) {
      throw new AggregateError(failures.map(result => result.reason), '升级夹具连接清理失败。')
    }
  }
}
