import type { Router } from 'vue-router'
import { NativeDatabase } from '../src/infrastructure/database/nativeAdapter'
import { dictionaryDefinitions } from '../src/domain/dictionaries'
import { click, requireValue, type, waitFor } from './domHarness'

function button(scope: string, label: string) {
  const target = [...document.querySelectorAll<HTMLButtonElement>(`${scope} button`)]
    .find(item => item.textContent?.trim() === label)
  requireValue(target, `未找到操作 ${label}`)
  target.click()
}

/** 测试包驱动正式页面。只有历史样本经原生连接准备，不替代页面请求或启用 T6 保存。 */
export async function dictionaryUi() {
  const app = (document.querySelector('#app') as Element & { __vue_app__?: { config: { globalProperties: { $router: Router } } } }).__vue_app__
  requireValue(app, '正式 Vue 入口未挂载')
  const router = app.config.globalProperties.$router
  const db = new NativeDatabase('ledger')
  const suffix = crypto.randomUUID().slice(0, 8)
  const original = `测试苹果-${suffix}`
  const renamed = `测试苹果改名-${suffix}`
  const retained = `保留苹果-${suffix}`
  async function page(kind: string, label: string) {
    await router.push(`/me/dictionaries/${kind}`)
    await waitFor(() => document.querySelector('h1')?.textContent === label
      && !!document.querySelector('.dictionary-result-count')?.textContent?.includes('共')
      && document.querySelector<HTMLButtonElement>(`[aria-label="刷新${label}"]`)?.disabled === false, `字典 ${label} 未读取`)
    requireValue(document.documentElement.scrollWidth <= innerWidth + 1, `${label} 横向溢出`)
  }
  async function create(name: string) {
    click('.dictionary-add-button')
    await waitFor(() => !!document.querySelector('#dictionary-editor[open]'), '新增弹窗未打开')
    type('#dictionary-name', name)
    await waitFor(() => document.querySelector<HTMLButtonElement>('#dictionary-editor .primary-button')?.disabled === false, '新增提交尚未就绪')
    click('#dictionary-editor .primary-button')
    await waitFor(() => !document.querySelector('#dictionary-editor[open]')
      && document.querySelector<HTMLButtonElement>(`[aria-label="管理${name}"]`)?.disabled === false, `新增后列表未更新：${name}`)
  }
  async function actions(name: string) {
    await waitFor(() => document.querySelector<HTMLButtonElement>(`[aria-label="管理${name}"]`)?.disabled === false, '管理操作尚未就绪')
    click(`[aria-label="管理${name}"]`)
    await waitFor(() => !!document.querySelector('#dictionary-actions[open]'), '管理抽屉未打开')
  }
  try {
    await router.push('/me/dictionaries')
    await waitFor(() => document.querySelectorAll('.settings-disclosure-list button').length === 8, '八类字典索引未就绪')
    for (const definition of dictionaryDefinitions) {
      await page(definition.type, definition.label)
    }
    await page('unit', '单位')
    await create(`斤-${suffix}`)
    await page('expense-category', '支出分类')
    await create(`水果-${suffix}`)
    await page('funding-channel', '资金渠道')
    await create(`零钱-${suffix}`)
    await page('product', '商品')
    await create(original)
    click('.dictionary-add-button')
    await waitFor(() => !!document.querySelector('#dictionary-editor[open]'), '重复项弹窗未打开')
    type('#dictionary-name', original)
    await new Promise(resolve => setTimeout(resolve, 0))
    click('#dictionary-editor .primary-button')
    await waitFor(() => document.querySelector('#dictionary-editor')?.textContent?.includes('等价名称') === true, '重名错误未显示')
    requireValue(document.querySelector<HTMLInputElement>('#dictionary-name')?.value === original, '错误清除了输入')
    await waitFor(() => document.querySelector<HTMLButtonElement>('#dictionary-editor .secondary-button')?.disabled === false, '错误后未恢复操作')
    click('#dictionary-editor .secondary-button')
    await waitFor(() => !document.querySelector('#dictionary-editor[open]'), '取消错误弹窗未完成')
    await create(retained)
    await actions(original)
    button('#dictionary-actions', '修改名称')
    await waitFor(() => !!document.querySelector('#dictionary-editor[open]'), '改名弹窗未打开')
    type('#dictionary-name', renamed)
    await new Promise(resolve => setTimeout(resolve, 0))
    click('#dictionary-editor .primary-button')
    await waitFor(() => !!document.querySelector(`[aria-label="管理${renamed}"]`) && !document.querySelector('#dictionary-editor[open]'), '改名后未刷新')
    await actions(renamed)
    button('#dictionary-actions', '停用')
    await waitFor(() => !!document.querySelector('#dictionary-status-confirm[open]'), '停用确认缺失')
    click('#dictionary-status-confirm .primary-button')
    await waitFor(() => !document.querySelector('#dictionary-status-confirm[open]'), '停用未完成')
    const row = () => document.querySelector(`[aria-label="管理${renamed}"]`)?.closest('li')
    await waitFor(() => row()?.textContent?.includes('停用') === true, '停用状态未呈现')
    await actions(renamed)
    button('#dictionary-actions', '恢复')
    await waitFor(() => row()?.textContent?.includes('启用') === true, '恢复状态未呈现')

    // 本轮独立模拟器的合成历史数据：T6 保存和 T9 明细尚未接通。
    const source = (await db.query('SELECT id FROM dictionary_item WHERE name=?', [renamed])).values![0].id as string
    const target = (await db.query('SELECT id FROM dictionary_item WHERE name=?', [retained])).values![0].id as string
    const funding = (await db.query("SELECT id FROM dictionary_item WHERE kind='FUNDING_CHANNEL' LIMIT 1")).values![0].id as string
    const primary = (await db.query('SELECT id FROM dictionary_item WHERE name=?', [`水果-${suffix}`])).values![0].id as string
    const unit = (await db.query('SELECT id FROM dictionary_item WHERE name=?', [`斤-${suffix}`])).values![0].id as string
    const ledgerId = crypto.randomUUID()
    const templateId = crypto.randomUUID()
    await db.beginTransaction()
    try {
      await db.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,product_id,product_name_snapshot)
        VALUES(?,'EXPENSE',1543,?,'历史现金','2026-11-15T01:00:00.000Z','2026-11-15',?,'历史苹果')`, [ledgerId, funding, source], false)
      await db.run(`INSERT INTO daily_entry_template(id,entry_type,display_name,normalized_name,product_id,product_name_snapshot,primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price_scaled,quantity_scaled,amount_cents,funding_channel_id,funding_channel_name_snapshot,last_used_at,created_at,updated_at)
        VALUES(?,'EXPENSE',?,?,?,?,?,'水果',?,'斤',123456,1250,1543,?,'历史现金','2026-11-15T01:00:00.000Z','2026-11-15T01:00:00.000Z','2026-11-15T01:00:00.000Z')`,
      [templateId, renamed, renamed.normalize('NFKC').toLowerCase(), source, renamed, primary, unit, funding], false)
      await db.commitTransaction()
    } catch (error) {
      await db.rollbackTransaction()
      throw error
    }
    async function preview() {
      await actions(renamed)
      button('#dictionary-actions', '合并到其他商品')
      await waitFor(() => document.querySelector<HTMLElement>('#product-merge[open]')?.dataset.motionPhase === 'open'
        && !!document.querySelector('#merge-target option[value="' + target + '"]'), '目标候选未加载')
      const select = document.querySelector<HTMLSelectElement>('#merge-target')
      requireValue(select, '目标选择器未挂载')
      select.value = target
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
      button('#product-merge', '预览合并影响')
      await waitFor(() => !!document.querySelector('.merge-impact'), '合并影响未显示')
      requireValue(document.querySelector('.merge-impact')?.textContent?.includes('1 条'), '账目引用计数错误')
      button('#product-merge', '继续合并')
      await waitFor(() => !!document.querySelector('#confirm-product-merge[open]'), '缺少最终合并确认')
    }
    await preview()
    click('#confirm-product-merge .secondary-button')
    await waitFor(() => !document.querySelector('#confirm-product-merge[open]'), '取消合并确认未关闭')
    requireValue((await db.query('SELECT product_id FROM ledger_entry WHERE id=?', [ledgerId])).values![0].product_id === source, '取消写入了历史引用')
    click('#product-merge button[aria-label="关闭"]')
    await waitFor(() => !document.querySelector('#product-merge[open]'), '合并抽屉未关闭')
    await preview()
    click('#confirm-product-merge .primary-button')
    await waitFor(() => !document.querySelector('#product-merge[open]') && !document.querySelector(`[aria-label="管理${renamed}"]`), '合并成功后列表未更新')
    const history = (await db.query('SELECT product_id,product_name_snapshot,CAST(amount_cents AS TEXT) AS cents FROM ledger_entry WHERE id=?', [ledgerId])).values![0]
    requireValue(history.product_id === target && history.product_name_snapshot === '历史苹果' && history.cents === '1543', '合并改写历史名称或金额')
    requireValue((await db.query('SELECT product_id FROM daily_entry_template WHERE id=?', [templateId])).values![0].product_id === target, '模板引用未迁移')
    await router.push('/entry')
    await waitFor(() => !!document.querySelector('#expense-product-search'), '未返回记账页')
    requireValue(performance.getEntriesByType('resource').every(item => !/^https?:/.test(item.name)), '出现联网资源')
    return { dictionaries: 8, createRenameDisableRestore: true, cancelWithoutWrite: true, mergeHistoryAndTemplate: true, remoteResources: 0 }
  } finally {
    await router.replace('/entry')
  }
}
