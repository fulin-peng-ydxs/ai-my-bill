import { LedgerDatabase, type SqlSession } from '../src/data/ledgerDatabase'
import { DictionaryService } from '../src/data/dictionaries/dictionaryService'
import { ProductService } from '../src/data/dictionaries/productService'
import { normalizedDictionaryName } from '../src/domain/text'
import { dictionaryKinds, type DictionaryType } from '../src/data/dictionaries/types'

/** Node SQLite 与 hosted XCTest 共用同一组行为场景；不代替真实触摸验收。 */
export function check(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error(message)
  }
}

export async function rejected(operation: () => Promise<unknown>, code?: string): Promise<void> {
  try {
    await operation()
  } catch (error) {
    check(!code || (error as { code?: string }).code === code, `拒绝码不符：期望 ${code}，实际 ${(error as { code?: string }).code}`)
    return
  }
  throw new Error(`未拒绝操作${code ? `：${code}` : ''}`)
}

export const dictionaryTypes = Object.keys(dictionaryKinds) as DictionaryType[]

export async function dictionaryCrudScenario(database: LedgerDatabase, type: DictionaryType) {
  const service = new DictionaryService(database)
  const name = `验收-${type}`
  const item = await service.create(type, name)
  check(item.type === type && item.status === 'ACTIVE', `${type} 新建响应不符`)
  check((await service.list(type, name, { candidates: true })).items.some(row => row.id === item.id), `${type} 新增未进入候选`)
  if (type === 'product') {
    const older = await service.create('product', 'A-旧候选')
    await database.write(sql => sql.run("UPDATE product_details SET updated_at='2000-01-01T00:00:00.000Z' WHERE product_id=?", [older.id]))
    check((await new ProductService(database).suggestions()).items[0].id === item.id, '新增商品未沿用更新时间优先的候选顺序')
    await database.write(sql => sql.run("UPDATE product_details SET updated_at='1970-01-01T00:00:00.000Z' WHERE product_id=?", [item.id]))
  }
  const renamed = await service.rename(type, item.id, `${name}-改名`)
  check(renamed.id === item.id && renamed.name.endsWith('改名'), `${type} 改名丢失稳定 ID`)
  if (type === 'product') {
    check((await new ProductService(database).suggestions()).items[0].id === item.id, '改名商品未刷新候选顺序')
  }
  await service.changeStatus(type, item.id, 'INACTIVE')
  check(!(await service.list(type, '', { candidates: true })).items.some(row => row.id === item.id), `${type} 停用后仍进入候选`)
  check((await service.get(type, item.id)).status === 'INACTIVE', `${type} 历史 ID 无法回显`)
  await service.changeStatus(type, item.id, 'ACTIVE')
  check((await service.list(type, '', { candidates: true })).items.some(row => row.id === item.id), `${type} 恢复后候选缺失`)
  check((await service.summaries()).items.find(row => row.type === type)!.active > 0, `${type} 索引数量不符`)
  return item
}

export async function dictionaryValidationScenario(database: LedgerDatabase) {
  const service = new DictionaryService(database)
  const product = await service.create('product', ' Ａ　 B\tC ')
  check(product.name === 'Ａ　 B\tC', '展示名不应被规范化键替换')
  await rejected(() => service.create('product', 'a b c'), 'DICTIONARY_NAME_CONFLICT')
  await rejected(() => service.rename('product', product.id, ' '), 'VALIDATION_FAILED')
  await rejected(() => service.create('product', '😀'.repeat(201)), 'VALIDATION_FAILED')
  await service.create('product', '😀'.repeat(200))
  await service.create('unit', '斤'.repeat(100))
  await rejected(() => service.create('unit', '斤'.repeat(101)), 'VALIDATION_FAILED')
  await service.create('location', 'literal %_\\ 地点')
  check((await service.list('location', '%_\\')).total === 1, 'LIKE 特殊字符被当作通配符')
  check((await service.list('product', "'; DROP TABLE dictionary_item;--")).total === 0, '搜索输入未按字面值处理')
  check((await service.list('product', 'Ａ B C')).items[0]?.id === product.id, 'NFKC 搜索不一致')
  await rejected(() => service.list('unit', '', { size: 101 }), 'VALIDATION_FAILED')
  await rejected(() => service.list('unit', '', { page: -1 }), 'VALIDATION_FAILED')
  await rejected(() => service.list('unit', '', { rootsOnly: true }), 'VALIDATION_FAILED')
  const aborted = new AbortController()
  aborted.abort()
  await rejected(() => service.list('product', '', {}, aborted.signal), 'OPERATION_CANCELLED')
  const root = await service.create('expense-category', '一级')
  const second = await service.create('expense-category', '二级', root.id)
  const otherRoot = await service.create('expense-category', '另一个一级')
  await service.create('expense-category', '二级', otherRoot.id)
  await rejected(() => service.create('expense-category', '二级', root.id), 'DICTIONARY_NAME_CONFLICT')
  await rejected(() => service.create('expense-category', '三级', second.id), 'VALIDATION_FAILED')
  await rejected(() => service.create('unit', '非法父级', root.id), 'VALIDATION_FAILED')
  await rejected(() => service.changeStatus('expense-category', root.id, 'INACTIVE'), 'ACTIVE_CHILDREN_EXIST')
  await service.changeStatus('expense-category', second.id, 'INACTIVE')
  await service.changeStatus('expense-category', root.id, 'INACTIVE')
  await rejected(() => service.changeStatus('expense-category', second.id, 'ACTIVE'), 'PARENT_CATEGORY_INACTIVE')
  await rejected(() => service.create('expense-category', '停用下新增', root.id), 'VALIDATION_FAILED')
  await service.changeStatus('expense-category', root.id, 'ACTIVE')
  await service.changeStatus('expense-category', second.id, 'ACTIVE')
  check((await service.list('expense-category', '', { parentId: root.id, status: 'ACTIVE' })).items[0].id === second.id, '分页前层级过滤不符')
  check((await service.list('expense-category', '', { rootsOnly: true })).items.every(row => !row.parentId), '一级列表混入子项')
  for (let i = 0; i < 23; i += 1) {
    await service.create('payer', `分页${String(i).padStart(2, '0')}`)
  }
  const first = await service.list('payer', '', { page: 0, size: 20 })
  const last = await service.list('payer', '', { page: 1, size: 20 })
  check(first.total === 23 && first.items.length === 20 && last.items.length === 3, '分页数量错误')
  check(new Set([...first.items, ...last.items].map(row => row.id)).size === 23, '分页重复或遗漏')
  return 'normalization-hierarchy-paging-and-cancellation'
}

export async function dictionarySortScenario(database: LedgerDatabase) {
  const service = new DictionaryService(database)
  const a = await service.create('unit', 'A')
  const b = await service.create('unit', 'B')
  const c = await service.create('unit', 'C')
  const before = await database.read(sql => sql.query('SELECT id,sort_order,row_version FROM dictionary_item WHERE kind=\'UNIT\' ORDER BY id'))
  // 夹具 UUID 来自正式 create；DDL 只插入此受控标识，不拼接用户输入。
  await database.write(sql => sql.run(`CREATE TEMP TRIGGER test_sort_failure BEFORE UPDATE OF sort_order ON dictionary_item
    WHEN NEW.id='${b.id}' BEGIN SELECT RAISE(ABORT,'controlled-sort-failure'); END;`))
  try {
    await rejected(() => service.move('unit', c.id, 'UP', a.id))
    const after = await database.read(sql => sql.query('SELECT id,sort_order,row_version FROM dictionary_item WHERE kind=\'UNIT\' ORDER BY id'))
    check(JSON.stringify(before) === JSON.stringify(after), '排序失败留下部分顺序或版本变化')
  } finally {
    await database.write(sql => sql.run('DROP TRIGGER temp.test_sort_failure'))
  }
  await service.move('unit', c.id, 'UP', a.id)
  check((await service.list('unit')).items.map(row => row.name).join(',') === 'C,A,B', '锚点向前排序不符')
  await service.move('unit', c.id, 'DOWN', b.id)
  check((await service.list('unit')).items.map(row => row.name).join(',') === 'A,B,C', '锚点向后排序不符')
  await service.move('unit', c.id, 'UP')
  check((await service.list('unit')).items.map(row => row.name).join(',') === 'A,C,B', '单步排序不符')
  const root = await service.create('expense-category', '父级')
  const child = await service.create('expense-category', '子级', root.id)
  await rejected(() => service.move('expense-category', child.id, 'UP', root.id), 'VALIDATION_FAILED')
  await service.changeStatus('unit', c.id, 'INACTIVE')
  await service.move('unit', c.id, 'UP', a.id)
  check((await service.list('unit')).items[0].id === c.id, '停用项在管理排序中丢失')
  return 'atomic-sibling-sorting'
}

export async function createMergeContext(database: LedgerDatabase, tag = '合并') {
  const dictionaries = new DictionaryService(database)
  const suffix = crypto.randomUUID().slice(0, 8)
  const source = await dictionaries.create('product', `${tag}源-${suffix}`)
  const target = await dictionaries.create('product', `${tag}目标-${suffix}`)
  const primary = await dictionaries.create('expense-category', `${tag}分类-${suffix}`)
  const secondary = await dictionaries.create('expense-category', `${tag}二级-${suffix}`, primary.id)
  const unit = await dictionaries.create('unit', `斤-${suffix}`)
  const funding = await dictionaries.create('funding-channel', `现金-${suffix}`)
  const purchase = await dictionaries.create('purchase-channel', `渠道-${suffix}`)
  const location = await dictionaries.create('location', `地点-${suffix}`)
  return { dictionaries, source, target, primary, secondary, unit, funding, purchase, location }
}
export type MergeContext = Awaited<ReturnType<typeof createMergeContext>>

export async function insertExpense(sql: SqlSession, context: MergeContext, id: string, productId: string, trashed = false) {
  await sql.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
    product_id,product_name_snapshot,primary_category_id,primary_category_name_snapshot,secondary_category_id,secondary_category_name_snapshot,
    unit_id,unit_name_snapshot,purchase_channel_id,purchase_channel_name_snapshot,location_label_id,location_label_name_snapshot,
    lifecycle_status,deleted_at,purge_after,created_at) VALUES(?,'EXPENSE',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [id, '1543', context.funding.id, '历史现金', '2026-11-15T01:00:00.000Z', '2026-11-15', productId, '历史苹果',
    context.primary.id, '历史一级', context.secondary.id, '历史二级', context.unit.id, '历史斤',
    context.purchase.id, '历史渠道', context.location.id, '历史地点', trashed ? 'TRASHED' : 'ACTIVE',
    trashed ? '2026-11-15T02:00:00.000Z' : null, trashed ? '2026-12-15T02:00:00.000Z' : null, '2026-11-15T01:00:00.000Z'])
}

export async function insertTemplate(sql: SqlSession, context: MergeContext, productId: string, name: string, used: string, amount = '1543') {
  const id = crypto.randomUUID()
  await sql.run(`INSERT INTO daily_entry_template(id,entry_type,display_name,normalized_name,product_id,product_name_snapshot,
    primary_category_id,primary_category_name_snapshot,secondary_category_id,secondary_category_name_snapshot,
    unit_id,unit_name_snapshot,unit_price_scaled,quantity_scaled,amount_cents,purchase_channel_id,purchase_channel_name_snapshot,
    location_label_id,location_label_name_snapshot,funding_channel_id,funding_channel_name_snapshot,last_used_at,created_at,updated_at)
    VALUES(?,'EXPENSE',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [id, name, normalizedDictionaryName(name), productId, name, context.primary.id, '分类', context.secondary.id, '二级',
    context.unit.id, '斤', '123456', '1250', amount, context.purchase.id, '渠道', context.location.id, '地点',
    context.funding.id, '现金', used, '2026-11-15T01:00:00.000Z', used])
  return id
}

export async function dictionaryReferencesScenario(database: LedgerDatabase) {
  const context = await createMergeContext(database, '引用')
  const { dictionaries, source, funding, unit, primary, secondary } = context
  const payer = await dictionaries.create('payer', '验收付款方')
  const category = await dictionaries.create('income-category', '验收收入分类')
  await database.write(async sql => {
    await insertExpense(sql, context, crypto.randomUUID(), source.id)
    await sql.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
      payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot) VALUES(?,'INCOME',?,?,?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), '100', funding.id, '历史收款', '2026-11-15T01:00:00.000Z', '2026-11-15', payer.id, '历史付款方', category.id, '历史收入分类'])
    await sql.run('INSERT INTO preference(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ['defaultFundingChannelId', JSON.stringify(funding.id)])
    await sql.run('UPDATE product_details SET default_primary_category_id=?,default_secondary_category_id=?,default_unit_id=?,last_funding_channel_id=? WHERE product_id=?',
      [primary.id, secondary.id, unit.id, funding.id, source.id])
  })
  for (const item of [source, funding, unit, primary, secondary, payer, category]) {
    check((await dictionaries.get(item.type, item.id)).referenced, `${item.type} 引用状态未投影`)
    await rejected(() => database.write(sql => sql.run('DELETE FROM dictionary_item WHERE id=?', [item.id])))
  }
  await rejected(() => database.write(sql => sql.run('UPDATE product_details SET default_unit_id=? WHERE product_id=?', [funding.id, source.id])))
  await dictionaries.rename('funding-channel', funding.id, '新资金渠道')
  await dictionaries.changeStatus('payer', payer.id, 'INACTIVE')
  check(!(await dictionaries.list('payer', '', { candidates: true })).items.some(row => row.id === payer.id), '付款方停用后仍可新选')
  const rows = await database.read(sql => sql.query('SELECT funding_channel_name_snapshot,payer_name_snapshot FROM ledger_entry ORDER BY entry_type'))
  check(rows[0].funding_channel_name_snapshot === '历史现金' && rows[1].payer_name_snapshot === '历史付款方', '改名或停用覆盖历史快照')
  const unused = await dictionaries.create('unit', '可删除未引用项')
  await database.write(sql => sql.run('DELETE FROM dictionary_item WHERE id=?', [unused.id]))
  await rejected(() => dictionaries.get('unit', unused.id), 'DICTIONARY_ITEM_NOT_FOUND')
  return 'typed-references-and-snapshot-protection'
}

export async function dictionaryMergeScenario(database: LedgerDatabase) {
  const context = await createMergeContext(database)
  const { dictionaries, source, target } = context
  const products = new ProductService(database)
  let sourceTemplate = ''
  let targetTemplate = ''
  await database.write(async sql => {
    await insertExpense(sql, context, crypto.randomUUID(), source.id)
    await insertExpense(sql, context, crypto.randomUUID(), source.id, true)
    sourceTemplate = await insertTemplate(sql, context, source.id, source.name, '2026-11-15T03:00:00.000Z')
    targetTemplate = await insertTemplate(sql, context, target.id, target.name, '2026-11-15T02:00:00.000Z', '999')
    await sql.run('UPDATE product_details SET last_unit_price_scaled=? WHERE product_id=?', ['330000', target.id])
  })
  const preview = await products.preview(source.id, target.id)
  check(preview.affectedLedgerEntries === 2 && preview.affectedTemplates === 1 && preview.templateConflict, '影响数量或模板冲突预览不符')
  check(await database.read(async sql => (await sql.query('SELECT * FROM product_merge_event')).length) === 0, '预览产生写入')
  await rejected(() => products.merge(source.id, source.id), 'PRODUCT_MERGE_TARGET_INVALID')
  await dictionaries.changeStatus('product', target.id, 'INACTIVE')
  await rejected(() => products.preview(source.id, target.id), 'PRODUCT_MERGE_TARGET_INVALID')
  await dictionaries.changeStatus('product', target.id, 'ACTIVE')
  const before = await database.read(sql => sql.query('SELECT id,product_id,CAST(amount_cents AS TEXT) AS cents,product_name_snapshot,row_version FROM ledger_entry ORDER BY id'))
  await database.write(sql => sql.run("CREATE TEMP TRIGGER test_merge_failure BEFORE INSERT ON product_merge_event BEGIN SELECT RAISE(ABORT,'controlled-merge-failure'); END;"))
  try {
    await rejected(() => products.merge(source.id, target.id))
    const after = await database.read(sql => sql.query('SELECT id,product_id,CAST(amount_cents AS TEXT) AS cents,product_name_snapshot,row_version FROM ledger_entry ORDER BY id'))
    check(JSON.stringify(before) === JSON.stringify(after), '合并故障后账目/金额/版本发生变化')
    check((await dictionaries.get('product', source.id)).status === 'ACTIVE', '合并故障后源商品状态改变')
    const retained = await database.read(sql => sql.query('SELECT id,product_id,CAST(amount_cents AS TEXT) AS cents FROM daily_entry_template ORDER BY id'))
    check(retained.length === 2 && retained.some(row => row.id === sourceTemplate && row.cents === '1543') && retained.some(row => row.id === targetTemplate && row.cents === '999'), '模板没有整体回滚')
    check(await database.read(async sql => (await sql.query("SELECT * FROM idempotency_result WHERE operation='product.merge'")).length) === 0, '失败留下成功幂等回执')
  } finally {
    await database.write(sql => sql.run('DROP TRIGGER temp.test_merge_failure'))
  }
  const [first, repeated] = await Promise.all([products.merge(source.id, target.id), products.merge(source.id, target.id)])
  check(first.mergeEventId === repeated.mergeEventId, '并发重复合并未返回相同结果')
  const rows = await database.read(sql => sql.query('SELECT product_id,product_name_snapshot,CAST(amount_cents AS TEXT) AS cents,row_version FROM ledger_entry'))
  check(rows.length === 2 && rows.every(row => row.product_id === target.id && row.product_name_snapshot === '历史苹果' && row.cents === '1543' && row.row_version === 2), '合并覆盖历史解释或金额/版本不符')
  const templates = await database.read(sql => sql.query('SELECT id,product_id,display_name,CAST(amount_cents AS TEXT) AS cents FROM daily_entry_template'))
  check(templates.length === 1 && templates[0].id === targetTemplate && templates[0].product_id === target.id && templates[0].display_name === target.name && templates[0].cents === '1543', '模板未保留目标 ID 或最新有效字段')
  check((await products.suggestions()).items.find(row => row.id === target.id)?.lastUnitPrice === '33.0000', '合并覆盖目标商品已有最近值')
  await rejected(() => dictionaries.get('product', source.id), 'DICTIONARY_ITEM_NOT_FOUND')
  await rejected(() => dictionaries.changeStatus('product', source.id, 'ACTIVE'), 'DICTIONARY_ITEM_NOT_FOUND')
  await database.close()
  await database.open()
  check((await products.merge(source.id, target.id)).mergeEventId === first.mergeEventId, '重启后合并回执丢失')
  const third = await dictionaries.create('product', '合并最终目标')
  await products.merge(target.id, third.id)
  check(await database.read(async sql => (await sql.query('SELECT merged_into_id FROM product_details WHERE product_id=?', [source.id]))[0].merged_into_id) === third.id, '链式合并未迁移既往去向')
  check(await database.read(async sql => (await sql.query('SELECT target_product_id FROM product_merge_event WHERE id=?', [first.mergeEventId]))[0].target_product_id) === target.id, '链式合并改写历史事件')
  return 'atomic-merge-template-conflict-idempotency-and-chain'
}

export async function dictionaryTemplateScenario(database: LedgerDatabase, variant: 'source-only' | 'target-newer' | 'rename-conflict') {
  const context = await createMergeContext(database, variant)
  const { dictionaries, source, target } = context
  const products = new ProductService(database)
  let retained = ''
  await database.write(async sql => {
    retained = await insertTemplate(sql, context, source.id, source.name, '2026-11-15T01:00:00.000Z')
    await insertExpense(sql, context, crypto.randomUUID(), source.id)
    if (variant === 'target-newer') {
      retained = await insertTemplate(sql, context, target.id, target.name, '2026-11-15T03:00:00.000Z', '999')
    }
  })
  if (variant === 'rename-conflict') {
    await dictionaries.rename('product', source.id, 'Ｎｅｗ　苹果')
    const renamed = await database.read(sql => sql.query('SELECT display_name,normalized_name,product_name_snapshot FROM daily_entry_template WHERE product_id=?', [source.id]))
    check(renamed[0].display_name === 'Ｎｅｗ　苹果' && renamed[0].normalized_name === 'new 苹果', '改名未原子迁移模板业务键')
    check(await database.read(async sql => (await sql.query('SELECT product_name_snapshot FROM ledger_entry'))[0].product_name_snapshot) === '历史苹果', '改名重写历史账目快照')
    const other = await dictionaries.create('product', '独立商品')
    await database.write(sql => insertTemplate(sql, context, other.id, '冲突模板名', '2026-11-15T02:00:00.000Z'))
    await rejected(() => dictionaries.rename('product', source.id, '冲突模板名'), 'DICTIONARY_NAME_CONFLICT')
    await database.write(sql => sql.run('UPDATE daily_entry_template SET display_name=?,normalized_name=? WHERE product_id=?', [target.name, normalizedDictionaryName(target.name), other.id]))
    await rejected(() => products.merge(source.id, target.id), 'PRODUCT_MERGE_CONFLICT')
    check((await dictionaries.get('product', source.id)).name === 'Ｎｅｗ　苹果', '冲突后字典被覆盖')
    check(await database.read(async sql => (await sql.query('SELECT * FROM product_merge_event')).length) === 0, '冲突后留下合并事件')
    return `template-${variant}`
  }
  await products.merge(source.id, target.id)
  const rows = await database.read(sql => sql.query('SELECT id,product_id,normalized_name,CAST(amount_cents AS TEXT) AS cents FROM daily_entry_template'))
  check(rows.length === 1 && rows[0].id === retained && rows[0].product_id === target.id && rows[0].normalized_name === normalizedDictionaryName(target.name), '模板保留 ID 或业务键不符')
  check(rows[0].cents === (variant === 'target-newer' ? '999' : '1543'), '模板最新字段选择不符')
  await rejected(() => database.write(sql => sql.run('DELETE FROM dictionary_item WHERE id=?', [source.id])))
  await database.write(sql => sql.run('UPDATE dictionary_item SET sort_order=2147483647 WHERE id=?', [source.id]))
  const next = await dictionaries.create('product', '隐藏合并项不影响新排序')
  check(next.sortOrder < 2147483647, '隐藏合并项污染排序归一化')
  await database.write(sql => sql.run(`UPDATE product_details SET default_primary_category_id=?,default_secondary_category_id=?,
    default_unit_id=?,last_funding_channel_id=?,last_purchase_channel_id=? WHERE product_id=?`,
  [context.primary.id, context.secondary.id, context.unit.id, context.funding.id, context.purchase.id, target.id]))
  for (const item of [context.secondary, context.unit, context.funding, context.purchase]) {
    await dictionaries.changeStatus(item.type, item.id, 'INACTIVE')
  }
  const suggestion = (await products.suggestions()).items.find(row => row.id === target.id)!
  check(suggestion.primaryCategoryId === context.primary.id && !suggestion.secondaryCategoryId && !suggestion.unitId && !suggestion.fundingChannelId && !suggestion.purchaseChannelId,
    '商品候选带出停用默认/最近引用')
  return `template-${variant}`
}

/** 与原 Java UUID.compareTo 的有符号高/低 64 位顺序对齐，覆盖同毫秒模板的确定性取舍。 */
export async function dictionaryTemplateTieScenario(database: LedgerDatabase) {
  const cases = [
    ['80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', false],
    ['70000001-0000-0000-0000-000000000001', '80000001-0000-0000-0000-000000000001', true],
    ['00000002-0000-0000-8000-000000000001', '00000002-0000-0000-7000-000000000001', false],
    ['00000003-0000-0000-0000-000000000001', '00000003-0000-0000-0000-000000000002', false],
  ] as const
  for (const [sourceId, targetId, sourceNewer] of cases) {
    const context = await createMergeContext(database, '同时间模板')
    const stamp = '2026-11-15T01:00:00.000Z'
    await database.write(async sql => {
      const source = await insertTemplate(sql, context, context.source.id, context.source.name, stamp, '1543')
      const target = await insertTemplate(sql, context, context.target.id, context.target.name, stamp, '999')
      await sql.run('UPDATE daily_entry_template SET id=? WHERE id=?', [sourceId, source])
      await sql.run('UPDATE daily_entry_template SET id=? WHERE id=?', [targetId, target])
    })
    await new ProductService(database).merge(context.source.id, context.target.id)
    const row = await database.read(async sql => (await sql.query(
      'SELECT id,product_id,CAST(amount_cents AS TEXT) AS cents FROM daily_entry_template WHERE product_id=?', [context.target.id],
    ))[0])
    check(row.id === targetId && row.cents === (sourceNewer ? '1543' : '999'), '同时间模板未沿用 Java UUID 取舍或目标 ID 丢失')
    check(await database.read(async sql => (await sql.query('SELECT id FROM daily_entry_template WHERE id=?', [sourceId])).length) === 0,
      '同时间模板未收敛来源')
  }
  return 'template-tie-java-signed-uuid-order'
}
