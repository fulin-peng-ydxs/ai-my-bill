import type { LedgerDatabase, SqlSession } from '../ledgerDatabase'
import { LocalError } from '../../domain/localError'
import {
  assertUniqueName, dictionaryFromSql, dictionaryOrderSql, fieldError, projectDictionary, referencedSql,
  requireDictionary, requireId, requireType, validateName, validateQuery, visibleSql, type DictionaryRow,
} from './repository'
import { dictionaryKinds, type DictionaryItem, type DictionaryPage, type DictionaryStatus, type DictionarySummaries, type DictionaryType } from './types'

export interface DictionaryListOptions {
  status?: DictionaryStatus | ''
  page?: number
  size?: number
  parentId?: string
  rootsOnly?: boolean
  candidates?: boolean
}

/** 八类字典共用生产账本队列和事务；页面仍消费原 DTO，不存在账户/服务器依赖。 */
export class DictionaryService {
  constructor(private readonly database: Pick<LedgerDatabase, 'read' | 'write'>) {}

  async summaries(signal?: AbortSignal): Promise<DictionarySummaries> {
    return this.database.read(async sql => {
      const counts = await sql.query(`SELECT d.kind, count(*) AS total,
        SUM(CASE WHEN d.status='ACTIVE' THEN 1 ELSE 0 END) AS active
        ${dictionaryFromSql} WHERE ${visibleSql} GROUP BY d.kind`)
      return { items: (Object.keys(dictionaryKinds) as DictionaryType[]).map(type => {
        const row = counts.find(item => item.kind === dictionaryKinds[type])
        return { type, total: Number(row?.total ?? 0), active: Number(row?.active ?? 0) }
      }) }
    }, signal)
  }

  async list(type: DictionaryType, query = '', options: DictionaryListOptions = {}, signal?: AbortSignal): Promise<DictionaryPage> {
    const kind = requireType(type)
    const normalized = validateQuery(query)
    const { page = 0, size = 100, status = '', parentId, rootsOnly = false, candidates = false } = options
    if (!Number.isSafeInteger(page) || page < 0 || page > 1_000_000 || !Number.isSafeInteger(size) || size < 1 || size > 100) {
      return Promise.reject(fieldError('page', '分页参数不合法。'))
    }
    if (status !== '' && status !== 'ACTIVE' && status !== 'INACTIVE') {
      return Promise.reject(fieldError('status', '字典状态不合法。'))
    }
    if ((parentId || rootsOnly) && type !== 'expense-category' || parentId && rootsOnly) {
      return Promise.reject(fieldError('parentId', '分类层级筛选不合法。'))
    }
    if (parentId) {
      requireId(parentId, 'parentId')
    }
    const values: (string | number | null)[] = [kind, normalized, normalized]
    const conditions = ['d.kind=?', '(?=\'\' OR instr(d.normalized_name,?)>0)', visibleSql]
    if (status || candidates) {
      conditions.push('d.status=?')
      values.push(candidates ? 'ACTIVE' : status)
    }
    if (parentId) {
      conditions.push('d.parent_id=?')
      values.push(parentId)
    } else if (rootsOnly) {
      conditions.push('d.parent_id IS NULL')
    }
    // 新填报层级候选也走原 list 接口；已停用父级下的子项不得成为新选择。
    if (candidates || status === 'ACTIVE' && (rootsOnly || parentId)) {
      conditions.push("(d.parent_id IS NULL OR parent.status='ACTIVE')")
    }
    return this.database.read(async sql => {
      const where = conditions.join(' AND ')
      const total = Number((await sql.query(`SELECT count(*) AS count ${dictionaryFromSql} WHERE ${where}`, values))[0].count)
      const rows = await sql.query(`SELECT d.*, parent.name AS parent_name, ${referencedSql} AS referenced
        ${dictionaryFromSql} WHERE ${where} ORDER BY ${dictionaryOrderSql} LIMIT ? OFFSET ?`, [...values, size, page * size])
      return { items: rows.map(row => projectDictionary(type, row as DictionaryRow)), total, page, size }
    }, signal)
  }

  async get(type: DictionaryType, id: string, signal?: AbortSignal): Promise<DictionaryItem> {
    return this.database.read(async sql => projectDictionary(type, await requireDictionary(sql, type, id)), signal)
  }

  async create(type: DictionaryType, name: string, parentId?: string): Promise<DictionaryItem> {
    const kind = requireType(type)
    const value = validateName(type, name)
    if (parentId !== undefined) {
      requireId(parentId, 'parentId')
    }
    return this.database.write(async sql => {
      await this.validateParent(sql, type, parentId)
      await assertUniqueName(sql, kind, value.normalized, parentId ?? null)
      let maximum = Number((await sql.query(`SELECT COALESCE(MAX(d.sort_order),-10) AS value ${dictionaryFromSql} WHERE d.kind=? AND d.parent_id IS ? AND ${visibleSql}`, [kind, parentId ?? null]))[0].value)
      if (maximum > 2147483637) {
        await this.writePositions(sql, kind, parentId ?? null)
        maximum = Number((await sql.query(`SELECT COALESCE(MAX(d.sort_order),-10) AS value ${dictionaryFromSql} WHERE d.kind=? AND d.parent_id IS ? AND ${visibleSql}`, [kind, parentId ?? null]))[0].value)
      }
      const id = crypto.randomUUID()
      await sql.run('INSERT INTO dictionary_item(id,kind,name,normalized_name,parent_id,status,sort_order) VALUES(?,?,?,?,?,\'ACTIVE\',?)',
        [id, kind, value.display, value.normalized, parentId ?? null, maximum + 10])
      await this.touchProduct(sql, type, id)
      return projectDictionary(type, await requireDictionary(sql, type, id))
    })
  }

  async rename(type: DictionaryType, id: string, name: string): Promise<DictionaryItem> {
    const value = validateName(type, name)
    return this.database.write(async sql => {
      const before = await requireDictionary(sql, type, id)
      await assertUniqueName(sql, requireType(type), value.normalized, before.parent_id, id)
      if (type === 'product') {
        const conflict = await sql.query("SELECT id FROM daily_entry_template WHERE entry_type='EXPENSE' AND normalized_name=? AND product_id<>? LIMIT 1", [value.normalized, id])
        if (conflict.length) {
          throw fieldError('name', '已有同名日常支出，请先处理模板冲突。', 'DICTIONARY_NAME_CONFLICT')
        }
        await sql.run(`UPDATE daily_entry_template SET display_name=?,normalized_name=?,product_name_snapshot=?,updated_at=?,row_version=row_version+1
          WHERE entry_type='EXPENSE' AND product_id=?`, [value.display, value.normalized, value.display, new Date().toISOString(), id])
      }
      await sql.run('UPDATE dictionary_item SET name=?,normalized_name=?,row_version=row_version+1 WHERE id=?', [value.display, value.normalized, id])
      await this.touchProduct(sql, type, id)
      return projectDictionary(type, await requireDictionary(sql, type, id))
    })
  }

  async changeStatus(type: DictionaryType, id: string, status: DictionaryStatus): Promise<DictionaryItem> {
    if (status !== 'ACTIVE' && status !== 'INACTIVE') {
      return Promise.reject(fieldError('status', '字典状态不合法。'))
    }
    return this.database.write(async sql => {
      const before = await requireDictionary(sql, type, id)
      if (before.status === status) {
        return projectDictionary(type, before)
      }
      if (type === 'expense-category') {
        if (status === 'INACTIVE' && !before.parent_id &&
          (await sql.query("SELECT id FROM dictionary_item WHERE parent_id=? AND status='ACTIVE' LIMIT 1", [id])).length) {
          throw new LocalError('ACTIVE_CHILDREN_EXIST', '请先停用该分类下的启用子分类。')
        }
        if (status === 'ACTIVE' && before.parent_id) {
          const parent = await requireDictionary(sql, 'expense-category', before.parent_id)
          if (parent.status !== 'ACTIVE') {
            throw new LocalError('PARENT_CATEGORY_INACTIVE', '请先恢复父分类。')
          }
        }
      }
      await sql.run('UPDATE dictionary_item SET status=?,row_version=row_version+1 WHERE id=?', [status, id])
      await this.touchProduct(sql, type, id)
      return projectDictionary(type, await requireDictionary(sql, type, id))
    })
  }

  async move(type: DictionaryType, id: string, direction: 'UP' | 'DOWN', targetId?: string): Promise<DictionaryItem> {
    if (direction !== 'UP' && direction !== 'DOWN') {
      return Promise.reject(fieldError('direction', '移动方向不合法。'))
    }
    if (targetId) {
      requireId(targetId, 'targetId')
    }
    return this.database.write(async sql => {
      const before = await requireDictionary(sql, type, id)
      const kind = requireType(type)
      const ranking = `SELECT d.id, ROW_NUMBER() OVER(ORDER BY d.sort_order,d.id) AS position
        ${dictionaryFromSql} WHERE d.kind=? AND d.parent_id IS ? AND ${visibleSql}`
      const values = [kind, before.parent_id]
      const current = Number((await sql.query(`SELECT position FROM (${ranking}) WHERE id=?`, [...values, id]))[0].position)
      const target = targetId
        ? (await sql.query(`SELECT id,position FROM (${ranking}) WHERE id=?`, [...values, targetId]))[0]
        : (await sql.query(`SELECT id,position FROM (${ranking}) WHERE position=?`, [...values, current + (direction === 'UP' ? -1 : 1)]))[0]
      if (!target) {
        if (targetId) {
          throw fieldError('targetId', '只能移动到当前字典的同级选项旁。')
        }
        return projectDictionary(type, before)
      }
      const anchor = Number(target.position)
      const destination = anchor + (direction === 'UP' ? 0 : 1) - (current < anchor ? 1 : 0)
      if (target.id !== id && destination !== current) {
        await this.writePositions(sql, kind, before.parent_id, current, destination)
        await this.touchProduct(sql, type, id)
      }
      return projectDictionary(type, await requireDictionary(sql, type, id))
    })
  }

  private async validateParent(sql: SqlSession, type: DictionaryType, parentId?: string): Promise<void> {
    if (!parentId) {
      return
    }
    if (type !== 'expense-category') {
      throw fieldError('parentId', '该字典不支持父级。')
    }
    requireId(parentId, 'parentId')
    const parent = await requireDictionary(sql, 'expense-category', parentId)
    if (parent.parent_id) {
      throw fieldError('parentId', '支出分类最多两级。')
    }
    if (parent.status !== 'ACTIVE') {
      throw fieldError('parentId', '不能在已停用分类下新增。')
    }
  }

  /** 沿用原商品候选按更新时间优先的顺序；未知旧时间仅在升级回填时保留纪元默认值。 */
  private async touchProduct(sql: SqlSession, type: DictionaryType, id: string): Promise<void> {
    if (type === 'product') {
      await sql.run('UPDATE product_details SET updated_at=? WHERE product_id=?', [new Date().toISOString(), id])
    }
  }

  /** 在 SQLite 内重排同级序列，避免将全部字典拉入 JS 或逐行跨桥写入；一个事务全有或全无。 */
  private async writePositions(sql: SqlSession, kind: string, parentId: string | null, from = 0, to = 0): Promise<void> {
    await sql.run(`WITH ranked AS (
      SELECT d.id, ROW_NUMBER() OVER(ORDER BY d.sort_order,d.id) AS position ${dictionaryFromSql}
      WHERE d.kind=? AND d.parent_id IS ? AND ${visibleSql}
    ), positions AS (
      SELECT id, CASE WHEN position=? THEN ?
        WHEN ?<? AND position>? AND position<=? THEN position-1
        WHEN ?>? AND position>=? AND position<? THEN position+1 ELSE position END AS position FROM ranked
    ) UPDATE dictionary_item SET sort_order=((SELECT position FROM positions WHERE positions.id=dictionary_item.id)-1)*10,
      row_version=row_version+1 WHERE id IN(SELECT id FROM positions)`,
    [kind, parentId, from, to, from, to, from, to, from, to, to, from])
  }
}
