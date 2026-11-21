import type { ExpenseReport, ExpenseReportDimension, IncomeReport, IncomeReportDimension } from '../../api/reports'
import type { LedgerFilters } from '../../api/ledgerEntries'
import { addBusinessDays, businessDayCount } from '../../domain/businessDates'
import { fromSqliteInteger, scaledIntegerToDecimal } from '../../domain/money'
import { LocalError, throwIfCancelled } from '../../domain/localError'
import { fieldError } from '../dictionaries/repository'
import { compileLedgerFilter } from '../entries/querySql'
import type { SqlSession } from '../ledgerDatabase'
import { compare, CostMedian, ExactMean, fraction, halfUp, type Fraction } from './reportMath'

export type Dimension = ExpenseReportDimension | IncomeReportDimension
type Row = Record<string, unknown>
type Point = ExpenseReport['points'][number]
const expenseDimensions = ['CATEGORY', 'PRODUCT', 'FUNDING_CHANNEL', 'PURCHASE_CHANNEL', 'LOCATION', 'HABIT', 'PRICE', 'FREQUENCY', 'QUALITY']
const incomeDimensions = ['CATEGORY', 'FUNDING_CHANNEL', 'PAYER', 'NAME', 'FREQUENCY']
const money = (value: bigint) => scaledIntegerToDecimal(value, 2)
const decimal = (value: bigint, scale: number) => scaledIntegerToDecimal(value, scale).replace(/\.?0+$/, '') || '0'
const text = (row: Row, key: string) => row[key] == null ? undefined : String(row[key])
const amount = (row: Row) => fromSqliteInteger(row.amount_text)
const cost = (row: Row): Fraction | undefined => row.quantity_text == null || fromSqliteInteger(row.quantity_text) <= 0n
  ? undefined : fraction(amount(row) * 10n, fromSqliteInteger(row.quantity_text))
const keyFor = (row: Row) => JSON.stringify([row.product_id, row.unit_id])
const epoch = (row: Row) => Date.parse(String(row.business_time))
const projection = `SELECT id,business_time,business_date,created_at,product_id,product_name_snapshot,unit_id,unit_name_snapshot,
  primary_category_id,primary_category_name_snapshot,secondary_category_id,secondary_category_name_snapshot,
  funding_channel_id,funding_channel_name_snapshot,purchase_channel_id,purchase_channel_name_snapshot,
  location_label_id,location_label_name_snapshot,income_category_id,income_category_name_snapshot,payer_id,payer_name_snapshot,income_name,
  CAST(amount_cents AS TEXT) AS amount_text,
  CAST(unit_price_scaled AS TEXT) AS price_text,CAST(quantity_scaled AS TEXT) AS quantity_text FROM ledger_entry l`

/** 有界桥接批次；同一次数据库 read 内分页，不能与正式写入交错，也不执行每笔历史查询。 */
async function readRows(sql: SqlSession, conditions: string[], values: (string | number | null)[], signal?: AbortSignal): Promise<Row[]> {
  const result: Row[] = []
  let cursor: Row | undefined
  for (;;) {
    throwIfCancelled(signal)
    const rows = await sql.query(`${projection} WHERE ${conditions.join(' AND ')}
      ${cursor ? 'AND (business_date,business_time,created_at,id)>(?,?,?,?)' : ''}
      ORDER BY business_date,business_time,created_at,id LIMIT 256`, [...values,
      ...(cursor ? [String(cursor.business_date), String(cursor.business_time), String(cursor.created_at), String(cursor.id)] : [])])
    result.push(...rows)
    if (rows.length < 256) break
    cursor = rows.at(-1)!
  }
  throwIfCancelled(signal)
  return result
}

/** 候选商品已在本次快照中确定；历史读取不再逐页重扫候选账目。 */
async function readQualityHistory(sql: SqlSession, candidates: Row[], signal?: AbortSignal): Promise<Row[]> {
  const products = [...new Set(candidates.map(row => row.product_id).filter((id): id is string => typeof id === 'string'))].sort()
  const lower = new Date(epoch(candidates[0]!) - 180 * 86400000).toISOString()
  const upper = String(candidates.at(-1)!.business_time)
  const result: Row[] = []
  // 固定商品批次限制绑定数；一次 SQL 最多合并“当前商品续页”和“后续商品”两条有序索引流。
  for (let offset = 0; offset < products.length; offset += 128) {
    const batch = products.slice(offset, offset + 128)
    let cursor: Row | undefined
    for (;;) {
      throwIfCancelled(signal)
      const branches: string[] = []
      const values: (string | number | null)[] = []
      const history = `${projection} WHERE entry_type='EXPENSE' AND lifecycle_status='ACTIVE'`
      if (cursor) {
        // 不叠加旧的时间下界：否则 SQLite 可能只从该下界扫描，无法按完整尾游标定位同时间记录。
        branches.push(`${history} AND product_id=? AND (business_time,created_at,id)>(?,?,?) AND business_time<=?`)
        values.push(String(cursor.product_id), String(cursor.business_time), String(cursor.created_at), String(cursor.id), upper)
      }
      const currentProduct = cursor ? String(cursor.product_id) : undefined
      const remaining = currentProduct === undefined ? batch : batch.filter(id => id > currentProduct)
      if (remaining.length) {
        branches.push(`${history} AND product_id IN (${remaining.map(() => '?').join(',')}) AND business_time BETWEEN ? AND ?`)
        values.push(...remaining, lower, upper)
      }
      const rows = await sql.query(`${branches.join(' UNION ALL ')} ORDER BY product_id,business_time,created_at,id LIMIT 256`, values)
      result.push(...rows)
      if (rows.length < 256) break
      cursor = rows.at(-1)!
    }
  }
  throwIfCancelled(signal)
  // 索引按商品分页；质量规则的 180 天滑窗仍消费全局时间顺序，同时间的稳定前序规则不变。
  return result.sort((a, b) => {
    for (const key of ['business_time', 'created_at', 'id']) {
      const left = String(a[key]), right = String(b[key])
      if (left !== right) return left < right ? -1 : 1
    }
    return 0
  })
}
type Group = { point: Point; total: bigint; average?: bigint; quantity: bigint; quantityCount: number; price: bigint; priceCount: number; min?: bigint; max?: bigint;
  latestPrice?: bigint; unit?: string; labelOrder: string; actual: ExactMean; first: string; last: string }
function grouped(rows: Row[], dimension: Dimension, income: boolean, primary: boolean, start: string, end: string): Point[] {
  const groups = new Map<string, Group>()
  const add = (row: Row, group: string, label: string, value: string, average?: bigint) => {
    const key = JSON.stringify([group, value]), day = String(row.business_date)
    let g = groups.get(key)
    if (!g) {
      g = { point: { group, label, value, amount: '0.00', itemCount: 0 }, total: 0n, quantity: 0n, quantityCount: 0,
        price: 0n, priceCount: 0, labelOrder: '', actual: new ExactMean(), first: day, last: day }
      groups.set(key, g)
    }
    const labelOrder = `${row.business_time}|${income ? '' : row.created_at}|${row.id}`
    if (labelOrder >= g.labelOrder) {
      g.point.label = label
      g.labelOrder = labelOrder
      g.unit = text(row, 'unit_name_snapshot')
    }
    g.point.itemCount++
    g.average = average
    g.total += amount(row)
    g.last = day
    if (dimension === 'PRODUCT' || dimension === 'PRICE') {
      if (row.quantity_text != null) {
        g.quantity += fromSqliteInteger(row.quantity_text)
        g.quantityCount++
      }
      // 历史 NULL 是缺失资料；不能以早一笔的填写单价冒充最新值。
      g.latestPrice = row.price_text == null ? undefined : fromSqliteInteger(row.price_text)
      if (row.price_text != null) {
        const price = fromSqliteInteger(row.price_text)
        g.price += price
        g.priceCount++
        g.min = g.min === undefined || price < g.min ? price : g.min
        g.max = g.max === undefined || price > g.max ? price : g.max
        g.latestPrice = price
      }
      if (dimension === 'PRICE') {
        const actual = cost(row)
        if (actual) g.actual.add(actual)
      }
    }
    g.point.amount = money(average ? halfUp(g.total, average) : dimension === 'FREQUENCY' ? BigInt(g.point.itemCount) * 100n : g.total)
  }
  for (const row of rows) {
    if (income) {
      const field = dimension === 'CATEGORY' ? 'income_category' : dimension === 'FUNDING_CHANNEL' ? 'funding_channel' : 'payer'
      const named = dimension === 'NAME' || dimension === 'FREQUENCY'
      add(row, ({ CATEGORY: '收入分类', FUNDING_CHANNEL: '收款方式', PAYER: '付款方', NAME: '收入名称', FREQUENCY: '收入频次' } as Record<string, string>)[dimension]!,
        String(named ? row.income_name : row[field + '_name_snapshot']), String(named ? row.income_name : row[field + '_id']))
    } else if (dimension === 'HABIT') {
      const date = new Date(String(row.business_date) + 'T00:00:00Z'), weekday = (date.getUTCDay() + 6) % 7 + 1
      const hour = new Date(epoch(row) + 8 * 3600000).getUTCHours(), band = Math.floor(hour / 6)
      add(row, '星期分布', ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][weekday - 1]!, `WEEKDAY:${weekday}`)
      add(row, '时段分布', ['凌晨', '上午', '下午', '晚上'][band]!, 'TIME:' + ['NIGHT', 'MORNING', 'AFTERNOON', 'EVENING'][band])
      add(row, '消费均值', '日均', 'AVERAGE:DAY', BigInt(businessDayCount(start, end)))
      const months = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1
      add(row, '消费均值', '月均', 'AVERAGE:MONTH', BigInt(months))
      add(row, '消费均值', '单条均值', 'AVERAGE:ENTRY')
    } else if (dimension === 'PRODUCT' || dimension === 'PRICE') {
      add(row, dimension === 'PRICE' ? '商品价格' : '商品与单位', `${row.product_name_snapshot} · ${row.unit_name_snapshot}`, `${row.product_id}|${row.unit_id}`)
    } else if (dimension === 'FREQUENCY') add(row, '高频商品', String(row.product_name_snapshot), String(row.product_id))
    else {
      const field = dimension === 'CATEGORY' ? primary ? 'secondary_category' : 'primary_category'
        : dimension === 'FUNDING_CHANNEL' ? 'funding_channel' : dimension === 'PURCHASE_CHANNEL' ? 'purchase_channel' : 'location_label'
      const group = dimension === 'CATEGORY' ? primary ? '二级分类' : '一级分类'
        : dimension === 'FUNDING_CHANNEL' ? '支付方式' : dimension === 'PURCHASE_CHANNEL' ? '购买渠道' : '常用地点'
      const id = text(row, field + '_id')
      add(row, group, text(row, field + '_name_snapshot') ?? (id ? '历史名称缺失'
        : field === 'secondary_category' ? '未选二级分类' : '未指定'), id ?? 'UNSPECIFIED')
    }
  }
  const total = rows.reduce((sum, row) => sum + amount(row), 0n)
  const weight = (g: Group): Fraction => dimension === 'PRICE' ? fraction(g.price, BigInt(g.priceCount || 1))
    : dimension === 'FREQUENCY' ? fraction(BigInt(g.point.itemCount))
      : fraction(g.total, g.average ?? (dimension === 'HABIT' && g.point.value === 'AVERAGE:ENTRY' ? BigInt(g.point.itemCount) : 1n))
  // 先按未舍入均值排名，最后才格式化；同样显示 12.35 的价格不能丢失真实先后。
  return [...groups.values()].filter(g => dimension !== 'PRICE' || g.priceCount > 0).sort((a, b) => compare(weight(b), weight(a))
    || (a.point.label < b.point.label ? -1 : a.point.label > b.point.label ? 1 : a.point.value < b.point.value ? -1 : a.point.value > b.point.value ? 1 : 0)).map(g => {
    const point = g.point, count = BigInt(point.itemCount)
    if (income) point.detail = dimension === 'FREQUENCY' ? `累计收入 ¥${money(g.total)} · 最近记录 ${g.last}`
      : `${count} 条收入明细${dimension === 'NAME' ? ` · 最近记录 ${g.last}` : ''}`
    else if (dimension === 'PRODUCT' || dimension === 'PRICE') {
      const average = g.priceCount ? money(halfUp(g.price, BigInt(g.priceCount) * 100n)) : '资料不足'
      const latest = g.latestPrice === undefined ? '资料不足' : money(halfUp(g.latestPrice, 100n))
      if (dimension === 'PRICE') point.amount = g.priceCount ? average : '0.00'
      point.detail = dimension === 'PRODUCT'
        ? `数量 ${g.quantityCount === point.itemCount ? decimal(g.quantity, 3) : '资料不足'} ${g.unit ?? ''} · 平均填写单价 ${average} · 最近 ${latest}`
        : `最低 ${g.min === undefined ? '资料不足' : money(halfUp(g.min, 100n))} · 最高 ${g.max === undefined ? '资料不足' : money(halfUp(g.max, 100n))} · 最近 ${latest} · 平均实际单位成本 ${g.actual.count ? money(g.actual.cents()) : '资料不足'}`
    } else if (dimension === 'HABIT') {
      if (point.value === 'AVERAGE:ENTRY') point.amount = money(halfUp(g.total, count))
      point.detail = point.value === 'AVERAGE:DAY' ? `按所选日期内全部自然日计算 · ${count} 条消费明细`
        : point.value === 'AVERAGE:MONTH' ? `按所选日期覆盖的自然月计算 · ${count} 条消费明细`
          : point.value === 'AVERAGE:ENTRY' ? `每条消费明细的平均实付 · ${count} 条消费明细` : `${count} 条消费明细`
    } else if (dimension === 'FREQUENCY') point.detail = `最近购买 ${g.last} · 平均复购间隔 ${point.itemCount < 2 ? '样本不足'
      // 沿用旧 numeric 平均天数的十进制精度；不擅自截成四位小数。
      : decimal(halfUp(BigInt(businessDayCount(g.first, g.last) - 1) * 10n ** 20n, count - 1n), 20) + ' 天'}`
    else point.detail = `${count} 条消费明细`
    if (dimension !== 'PRICE' && dimension !== 'FREQUENCY' && total > 0n && !(dimension === 'HABIT' && point.group === '消费均值'))
      point.sharePercent = money(halfUp(g.total * 10000n, total))
    return point
  })
}
function ranking(a: Point, b: Point): number {
  const difference = BigInt(b.amount.replace('.', '')) - BigInt(a.amount.replace('.', ''))
  return difference < 0n ? -1 : difference > 0n ? 1 : a.label < b.label ? -1 : a.label > b.label ? 1 : a.value < b.value ? -1 : a.value > b.value ? 1 : 0
}

function quality(rows: Row[], candidates: Set<string>, signal?: AbortSignal): Point[] {
  const costs = new Map<string, Fraction[]>(), states = new Map<string, CostMedian>()
  const points: (Point & { order: string[] })[] = []
  const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
  for (const row of rows) {
    const actual = cost(row)
    if (actual) {
      const key = keyFor(row), values = costs.get(key) ?? []
      values.push(actual)
      costs.set(key, values)
    }
  }
  for (const [key, values] of costs) states.set(key, new CostMedian(values))
  const duplicates = new Map<string, number>()
  let expired = 0
  const offer = (row: Row, warning: string, detail: string) => {
    points.push({ group: '数据质量', label: String(row.product_name_snapshot), value: String(row.id), entryId: String(row.id),
      amount: money(amount(row)), itemCount: 1, warning, detail,
      order: [String(row.business_time), String(row.created_at), String(row.id), warning === '疑似重复线索' ? 'DUPLICATE' : 'HIGH_PRICE'] })
    // 输出只保留最新 101 条以判断截断；不为全部历史样本创建提示对象。
    points.sort((a, b) => lexical(b.order[0]!, a.order[0]!) || lexical(b.order[1]!, a.order[1]!)
      || lexical(a.order[2]!, b.order[2]!) || lexical(a.order[3]!, b.order[3]!))
    if (points.length > 101) points.pop()
  }
  for (let first = 0; first < rows.length;) {
    throwIfCancelled(signal)
    const time = epoch(rows[first]!)
    while (expired < first && epoch(rows[expired]!) < time - 180 * 86400000) {
      const row = rows[expired++]!, value = cost(row)
      if (value) states.get(keyFor(row))!.update(value, -1)
    }
    let end = first
    while (end < rows.length && epoch(rows[end]!) === time) end++
    // 同时间的价格不互作历史；重复判断仍按 time/created/id 的稳定先后顺序。
    for (let index = first; index < end; index++) {
      const row = rows[index]!, duplicateKey = JSON.stringify([row.product_id, row.amount_text, row.funding_channel_id])
      if (candidates.has(String(row.id))) {
        const actual = cost(row), state = states.get(keyFor(row))
        if (actual && state && state.count >= 3) {
          const median = state.median()
          if (actual.n * median.d * 2n > median.n * actual.d * 3n)
            offer(row, '异常高价线索', `实际单位成本 ${money(halfUp(actual.n * 100n, actual.d))} · 历史中位数 ${money(halfUp(median.n * 100n, median.d))}`)
        }
        if (duplicates.has(duplicateKey) && time - duplicates.get(duplicateKey)! <= 10 * 60000)
          offer(row, '疑似重复线索', '同商品、实付金额和资金渠道在 10 分钟内重复出现')
      }
      duplicates.set(duplicateKey, time)
    }
    for (let index = first; index < end; index++) {
      const row = rows[index]!, value = cost(row)
      if (value) states.get(keyFor(row))!.update(value, 1)
    }
    first = end
  }
  return points.map(({ order: _, ...point }) => point)
}

/** 所有维度与 T10 摘要共享队列读、过滤编译器和一次业务时钟，派生结果不落盘。 */
export async function dimensionReport(sql: SqlSession, filters: LedgerFilters, dimension: Dimension, now: Date, signal?: AbortSignal): Promise<{ expense?: ExpenseReport; income?: IncomeReport }> {
  const income = filters.type === 'INCOME'
  if (!(income ? incomeDimensions : expenseDimensions).includes(dimension)) throw fieldError('dimension', '请选择有效的分析维度。')
  const scoped = { ...filters, type: income ? 'INCOME' as const : 'EXPENSE' as const }
  const plan = compileLedgerFilter(scoped, now)
  const rows = await readRows(sql, plan.conditions, plan.values, signal)
  const incomeField = dimension === 'CATEGORY' ? 'income_category' : dimension === 'PAYER' ? 'payer' : 'funding_channel'
  const required = income ? dimension === 'NAME' || dimension === 'FREQUENCY' ? ['income_name']
    : [incomeField + '_id', incomeField + '_name_snapshot']
    : dimension === 'PRODUCT' || dimension === 'PRICE' ? ['product_id', 'product_name_snapshot', 'unit_id', 'unit_name_snapshot']
      : dimension === 'FREQUENCY' ? ['product_id', 'product_name_snapshot']
        : dimension === 'CATEGORY' ? ['primary_category_id', 'primary_category_name_snapshot'] : []
  if (rows.some(row => required.some(field => row[field] == null)))
    throw new LocalError('REPORT_ENTRY_INCOMPATIBLE', '部分历史账目缺少此维度所需资料，请缩小筛选范围；账目和总览仍保留。')
  let points: Point[]
  if (dimension === 'QUALITY' && rows.length) {
    const history = await readQualityHistory(sql, rows, signal)
    points = quality(history, new Set(rows.map(row => String(row.id))), signal)
  } else points = grouped(rows, dimension, income, Boolean(filters.primaryCategoryId), plan.start, plan.end)
  if (!income && dimension === 'FREQUENCY' && plan.start > '0001-01-01') {
    const historical = compileLedgerFilter({ ...scoped, range: 'CUSTOM', startDate: '0001-01-01', endDate: addBusinessDays(plan.start, -1) }, now)
    const past = await readRows(sql, [...historical.conditions,
      "EXISTS(SELECT 1 FROM dictionary_item d WHERE d.id=l.product_id AND d.status='ACTIVE')"], historical.values, signal)
    const present = new Set(rows.map(row => row.product_id)), byProduct = new Map<string, Row[]>()
    for (const row of past) if (!present.has(row.product_id)) {
      const key = String(row.product_id), values = byProduct.get(key) ?? []
      values.push(row)
      byProduct.set(key, values)
    }
    for (const values of byProduct.values()) {
      const latest = values.at(-1)!, date = String(latest.business_date)
      points.push({ group: '长期未购买', label: String(latest.product_name_snapshot), value: String(latest.product_id),
        entryId: String(latest.id), drillStartDate: date, drillEndDate: date, amount: money(BigInt(values.length) * 100n), itemCount: values.length,
        detail: `报告期内 0 条 · 上次购买 ${date} · 历史共 ${values.length} 条` })
    }
  }
  throwIfCancelled(signal)
  if (dimension === 'FREQUENCY') points.sort((a, b) => Number(a.group === '长期未购买') - Number(b.group === '长期未购买') || ranking(a, b))
  const limit = dimension === 'QUALITY' ? 100 : 50, truncated = points.length > limit
  if (income) return { income: { dimension: dimension as IncomeReportDimension, measureLabel: dimension === 'FREQUENCY' ? '收入明细数' : '收入金额（元）', points: points.slice(0, limit), truncated } }
  return { expense: { dimension: dimension as ExpenseReportDimension,
    measureLabel: dimension === 'PRICE' ? '填写单价（元）' : dimension === 'FREQUENCY' ? '消费明细数' : dimension === 'QUALITY' ? '质量线索' : '原始支出（元）',
    points: points.slice(0, limit), truncated, ...(dimension === 'QUALITY' ? { qualityRule: { version: 'expense-quality-v1', priceWindowDays: 180,
      minimumPriceSamples: 3, highPriceMultiplier: '1.50', duplicateWindowMinutes: 10 } } : {}) } }
}
