import type { LedgerDatabase, SqlSession } from '../ledgerDatabase'
import { sha256 } from '../migrations'
import { LocalError } from '../../domain/localError'
import { fromSqliteInteger, scaledIntegerToDecimal } from '../../domain/money'
import { fieldError, requireId, validateQuery } from './repository'
import type { ProductMergePreview, ProductMergeResult, ProductSuggestion } from './types'

type Product = { id: string; name: string; normalized_name: string; status: string; merged_into_id: string | null }
type Pair = { source: Product; target: Product }
type Template = Record<string, string | number | null> & { id: string; last_used_at: string; updated_at: string }

const templatePayload = ['source_record_id', 'primary_category_id', 'primary_category_name_snapshot',
  'secondary_category_id', 'secondary_category_name_snapshot', 'unit_id', 'unit_name_snapshot',
  'unit_price_scaled', 'quantity_scaled', 'amount_cents', 'purchase_channel_id', 'purchase_channel_name_snapshot',
  'location_label_id', 'location_label_name_snapshot', 'funding_channel_id', 'funding_channel_name_snapshot', 'last_used_at'] as const
const scaledColumns = new Set<string>(['unit_price_scaled', 'quantity_scaled', 'amount_cents'])
const templateProjection = ['id', 'product_id', 'updated_at', ...templatePayload]
  .map(field => scaledColumns.has(field) ? `CAST(${field} AS TEXT) AS ${field}` : field).join(',')

/** 商品候选及合并协调。账目、模板、合并去向、事件和幂等回执只在同一账本事务写入。 */
export class ProductService {
  constructor(private readonly database: Pick<LedgerDatabase, 'read' | 'executeOnce'>) {}

  async suggestions(query = '', signal?: AbortSignal): Promise<{ items: ProductSuggestion[] }> {
    const normalized = validateQuery(query)
    return this.database.read(async sql => {
      const rows = await sql.query(`SELECT d.id,d.name, pc.id AS primary_id,pc.name AS primary_name,
        sc.id AS secondary_id,sc.name AS secondary_name,u.id AS unit_id,u.name AS unit_name,
        CAST(p.last_unit_price_scaled AS TEXT) AS last_unit_price,
        f.id AS funding_id,f.name AS funding_name,c.id AS purchase_id,c.name AS purchase_name
        FROM dictionary_item d JOIN product_details p ON p.product_id=d.id
        LEFT JOIN dictionary_item pc ON pc.id=p.default_primary_category_id AND pc.status='ACTIVE' AND pc.parent_id IS NULL
        LEFT JOIN dictionary_item sc ON sc.id=p.default_secondary_category_id AND sc.status='ACTIVE' AND sc.parent_id=pc.id
        LEFT JOIN dictionary_item u ON u.id=p.default_unit_id AND u.status='ACTIVE'
        LEFT JOIN dictionary_item f ON f.id=p.last_funding_channel_id AND f.status='ACTIVE'
        LEFT JOIN dictionary_item c ON c.id=p.last_purchase_channel_id AND c.status='ACTIVE'
        WHERE d.kind='PRODUCT' AND d.status='ACTIVE' AND p.merged_into_id IS NULL
          AND (?='' OR instr(d.normalized_name,?)>0)
        ORDER BY p.updated_at DESC,d.name,d.id LIMIT 20`, [normalized, normalized])
      return { items: rows.map(row => ({
        id: String(row.id),
        name: String(row.name),
        ...(row.primary_id ? { primaryCategoryId: String(row.primary_id), primaryCategoryName: String(row.primary_name) } : {}),
        ...(row.secondary_id ? { secondaryCategoryId: String(row.secondary_id), secondaryCategoryName: String(row.secondary_name) } : {}),
        ...(row.unit_id ? { unitId: String(row.unit_id), unitName: String(row.unit_name) } : {}),
        ...(row.last_unit_price !== null ? { lastUnitPrice: scaledIntegerToDecimal(fromSqliteInteger(row.last_unit_price), 4) } : {}),
        ...(row.funding_id ? { fundingChannelId: String(row.funding_id), fundingChannelName: String(row.funding_name) } : {}),
        ...(row.purchase_id ? { purchaseChannelId: String(row.purchase_id), purchaseChannelName: String(row.purchase_name) } : {}),
      })) }
    }, signal)
  }

  preview(sourceId: string, targetId: string): Promise<ProductMergePreview> {
    return this.database.read(async sql => this.impact(sql, await this.resolvePair(sql, sourceId, targetId)))
  }

  async merge(sourceId: string, targetId: string): Promise<ProductMergeResult> {
    requireId(sourceId, 'sourceProductId')
    requireId(targetId, 'targetProductId')
    // 原入口不传操作 ID；一对稳定商品只能合并一次，以确定键保证提交回执丢失后可查回原结果。
    const digest = sha256(JSON.stringify({ sourceId, targetId }))
    return this.database.executeOnce('product.merge', digest, digest, async sql => {
      const pair = await this.resolvePair(sql, sourceId, targetId)
      const impact = await this.impact(sql, pair)
      const templates = await this.templates(sql, sourceId, targetId)
      const sourceTemplate = templates.find(row => row.product_id === sourceId)
      const targetTemplate = templates.find(row => row.product_id === targetId)
      const conflicting = await sql.query(`SELECT id FROM daily_entry_template WHERE entry_type='EXPENSE'
        AND normalized_name=? AND product_id NOT IN(?,?) LIMIT 1`, [pair.target.normalized_name, sourceId, targetId])
      if (conflicting.length) {
        throw new LocalError('PRODUCT_MERGE_CONFLICT', '已有同名日常支出，请先处理模板冲突。')
      }
      const now = new Date().toISOString()
      if (sourceTemplate && targetTemplate) {
        if (this.newer(sourceTemplate, targetTemplate)) {
          await this.updateTemplate(sql, targetTemplate.id, pair.target, now, sourceTemplate)
        } else {
          await this.updateTemplate(sql, targetTemplate.id, pair.target, now)
        }
        await sql.run('DELETE FROM daily_entry_template WHERE id=?', [sourceTemplate.id])
      } else if (sourceTemplate) {
        await this.updateTemplate(sql, sourceTemplate.id, pair.target, now)
      }

      const changed = await sql.run('UPDATE ledger_entry SET product_id=?,row_version=row_version+1 WHERE product_id=?', [targetId, sourceId])
      if (changed !== impact.affectedLedgerEntries) {
        throw new LocalError('PRODUCT_MERGE_CONFLICT', '商品引用已变化，请重新查看影响后重试。')
      }
      // 保留目标已有默认/最近值；源商品不再进入候选，既往合并源的当前去向直接指向新目标。
      await sql.run('UPDATE product_details SET merged_into_id=?,updated_at=? WHERE merged_into_id=?', [targetId, now, sourceId])
      await sql.run('UPDATE dictionary_item SET status=\'INACTIVE\',row_version=row_version+1 WHERE id=?', [sourceId])
      await sql.run('UPDATE product_details SET merged_into_id=?,updated_at=? WHERE product_id=?', [targetId, now, sourceId])
      const mergeEventId = crypto.randomUUID()
      await sql.run(`INSERT INTO product_merge_event(id,source_product_id,target_product_id,affected_ledger_entries,
        affected_templates,template_conflict,occurred_at) VALUES(?,?,?,?,?,?,?)`,
      [mergeEventId, sourceId, targetId, changed, impact.affectedTemplates, Number(impact.templateConflict), now])
      return { mergeEventId, impact }
    })
  }

  private async resolvePair(sql: SqlSession, sourceId: string, targetId: string): Promise<Pair> {
    requireId(sourceId, 'sourceProductId')
    requireId(targetId, 'targetProductId')
    if (sourceId === targetId) {
      throw fieldError('targetProductId', '不能将商品合并到自身。', 'PRODUCT_MERGE_TARGET_INVALID')
    }
    const rows = await sql.query(`SELECT d.id,d.name,d.normalized_name,d.status,p.merged_into_id
      FROM dictionary_item d JOIN product_details p ON p.product_id=d.id
      WHERE d.kind='PRODUCT' AND d.id IN(?,?)`, [sourceId, targetId]) as Product[]
    const source = rows.find(row => row.id === sourceId)
    const target = rows.find(row => row.id === targetId)
    if (!source || !target) {
      throw new LocalError('PRODUCT_NOT_FOUND', '商品不存在。')
    }
    if (source.merged_into_id) {
      throw new LocalError('PRODUCT_MERGE_CONFLICT', '源商品已经被合并，请刷新后重试。')
    }
    if (target.status !== 'ACTIVE' || target.merged_into_id) {
      throw fieldError('targetProductId', '只能合并到启用中的商品。', 'PRODUCT_MERGE_TARGET_INVALID')
    }
    return { source, target }
  }

  private async impact(sql: SqlSession, pair: Pair): Promise<ProductMergePreview> {
    const count = Number((await sql.query('SELECT count(*) AS count FROM ledger_entry WHERE product_id=?', [pair.source.id]))[0].count)
    const templates = await this.templates(sql, pair.source.id, pair.target.id)
    const sourceExists = templates.some(row => row.product_id === pair.source.id)
    return {
      source: { id: pair.source.id, name: pair.source.name },
      target: { id: pair.target.id, name: pair.target.name },
      affectedLedgerEntries: count,
      affectedTemplates: Number(sourceExists),
      templateConflict: sourceExists && templates.some(row => row.product_id === pair.target.id),
    }
  }

  private templates(sql: SqlSession, sourceId: string, targetId: string): Promise<Template[]> {
    return sql.query(`SELECT ${templateProjection} FROM daily_entry_template
      WHERE entry_type='EXPENSE' AND product_id IN(?,?)`, [sourceId, targetId]) as Promise<Template[]>
  }

  private newer(source: Template, target: Template): boolean {
    const used = Date.parse(source.last_used_at) - Date.parse(target.last_used_at)
    const updated = Date.parse(source.updated_at) - Date.parse(target.updated_at)
    if (used !== 0) return used > 0
    if (updated !== 0) return updated > 0
    return this.compareUuid(source.id, target.id) > 0
  }

  /** 原 Java UUID.compareTo 依次比较两个有符号 long；字符串顺序在最高位为 1 时相反。 */
  private compareUuid(left: string, right: string): number {
    const parts = (id: string) => {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
        throw new LocalError('DATABASE_INCOMPATIBLE', '日常模板标识不合法，请使用兼容版本或备份恢复。')
      }
      const hex = id.replaceAll('-', '')
      return [BigInt.asIntN(64, BigInt('0x' + hex.slice(0, 16))), BigInt.asIntN(64, BigInt('0x' + hex.slice(16)))]
    }
    const a = parts(left)
    const b = parts(right)
    for (let index = 0; index < 2; index += 1) {
      if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
    }
    return 0
  }

  private async updateTemplate(sql: SqlSession, id: string, target: Product, now: string, payload?: Template): Promise<void> {
    const assignments = ['product_id=?', 'product_name_snapshot=?', 'display_name=?', 'normalized_name=?', 'updated_at=?']
    const values: (string | number | null)[] = [target.id, target.name, target.name, target.normalized_name, now]
    if (payload) {
      for (const field of templatePayload) {
        assignments.push(`${field}=?`)
        values.push(payload[field])
      }
    }
    await sql.run(`UPDATE daily_entry_template SET ${assignments.join(',')},row_version=row_version+1 WHERE id=?`, [...values, id])
  }
}
