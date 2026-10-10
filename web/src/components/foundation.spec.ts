import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'

import AppDialog from './AppDialog.vue'
import AppPagination from './AppPagination.vue'
import AppDataTable from './AppDataTable.vue'
import AppStateBlock from './AppStateBlock.vue'
import AppToast from './AppToast.vue'
import ChartPanel from './ChartPanel.vue'
import ReportDimensionPanel from './ReportDimensionPanel.vue'
import DataExportAction from './DataExportAction.vue'
import AppliedFilterBar from './AppliedFilterBar.vue'
import FilterSheet from './FilterSheet.vue'
import FormField from './FormField.vue'
import GlobalLedgerSearch from './GlobalLedgerSearch.vue'
import IncrementalLedgerList from './IncrementalLedgerList.vue'
import MoneySummary from './MoneySummary.vue'
import SegmentedControl from './SegmentedControl.vue'
import TimeTrendPanel from './TimeTrendPanel.vue'
import SettingsDisclosureList from './SettingsDisclosureList.vue'

async function render(component: Parameters<typeof h>[0], props?: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}

describe('shared frontend foundations', () => {
  it('exposes page boundaries and prevents paging during a refresh', async () => {
    expect(await render(AppPagination, { page: 0, totalPages: 1, label: '用户分页' })).not.toContain('<nav')
    const first = await render(AppPagination, { page: 0, totalPages: 3, label: '用户分页' })
    expect(first).toContain('aria-label="用户分页"')
    expect(first).toContain('第 1 / 3 页')
    expect(first.match(/<button[^>]*disabled/g)).toHaveLength(1)
    const last = await render(AppPagination, { page: 2, totalPages: 3, label: '用户分页' })
    expect(last).toContain('第 3 / 3 页')
    expect(last.match(/<button[^>]*disabled/g)).toHaveLength(1)
    const busy = await render(AppPagination, { page: 1, totalPages: 3, label: '用户分页', busy: true })
    expect(busy).toContain('aria-busy="true"')
    expect(busy.match(/<button[^>]*disabled/g)).toHaveLength(2)
  })
  it('renders mutually exclusive loading and permission states accessibly', async () => {
    const loading = await render(AppStateBlock, { kind: 'loading', title: '正在加载' })
    expect(loading).toContain('aria-busy="true"')
    expect(loading).not.toContain('state-block-empty')

    const permission = await render(AppStateBlock, {
      kind: 'permission', title: '无权访问', actionLabel: '返回登录',
    })
    expect(permission).toContain('role="alert"')
    expect(permission).toContain('返回登录')
  })

  it('links field help and errors to the actual form control', async () => {
    const app = createSSRApp({
      render: () => h(FormField, {
        fieldId: 'amount', label: '实付金额', help: '最多两位小数', error: '金额超出范围',
      }, {
        default: ({ describedBy }: { describedBy?: string }) => h('input', {
          id: 'amount', 'aria-describedby': describedBy,
        }),
      }),
    })
    const html = await renderToString(app)
    expect(html).toContain('for="amount"')
    expect(html).toContain('aria-describedby="amount-help amount-error"')
    expect(html).toContain('role="alert"')
  })

  it('describes composite field help as part of the same input', async () => {
    const app = createSSRApp({
      render: () => h(FormField, { fieldId: 'paid', label: '实付金额' }, {
        default: ({ describedBy }: { describedBy?: string }) => h('input', {
          id: 'paid', 'aria-describedby': describedBy,
        }),
        help: () => ['低于计算金额 ¥28.00', h('span', '计算金额 ¥204.00')],
      }),
    })
    const html = await renderToString(app)
    expect(html).toContain('aria-describedby="paid-help"')
    expect(html).toMatch(/id="paid-help"[^>]*>.*低于计算金额.*计算金额 ¥204\.00/)
  })

  it('renders segmented choice, search and filter contracts with accessible names', async () => {
    const segmented = await render(SegmentedControl, {
      label: '账目类型', modelValue: 'expense', options: [
        { value: 'expense', label: '支出' }, { value: 'income', label: '收入' },
      ],
    })
    expect(segmented).toContain('账目类型')
    expect(segmented).toContain('aria-pressed="true"')

    const search = await render(GlobalLedgerSearch, {
      id: 'report-search', modelValue: '', label: '搜索全部账目',
    })
    expect(search).toContain('搜索全部账目')
    expect(search).toContain('enterkeyhint="search"')

    const filters = await render(AppliedFilterBar, { summaries: [{ key: 'range', label: '日期', value: '本月' }, { key: 'type', label: '类型', value: '仅支出' }], clearable: true })
    expect(filters).toContain('修改日期，当前本月')
    expect(filters).toContain('筛选条件')
    expect(filters).toContain('清除全部筛选')
  })

  it('keeps default-date context visible without offering a no-op reset', async () => {
    const filters = await render(AppliedFilterBar, { summaries: [{ key: 'range', label: '日期', value: '今天' }], clearable: false })
    expect(filters).toContain('今天')
    expect(filters).not.toContain('清除全部筛选')
  })

  it('renders exact signed money semantics and stable settings disclosure values', async () => {
    const money = await render(MoneySummary, { items: [
      { key: 'income', label: '收入', amount: '1234.5', tone: 'income', sign: '+' },
      { key: 'expense', label: '支出', amount: '20', tone: 'expense', sign: '-' },
    ] })
    expect(money).toContain('+¥1,234.50')
    expect(money).toContain('-¥20</dd>')
    expect(money).toContain('正')
    expect(money).toContain('负')

    const settings = await render(SettingsDisclosureList, {
      label: '偏好设置', items: [{ key: 'theme', label: '外观', value: '跟随系统' }],
    })
    expect(settings).toContain('<ul')
    expect(settings).toContain('偏好设置')
    expect(settings).toContain('跟随系统')
  })

  it('keeps income, expense and adjustment card amounts consistent with summary semantics', async () => {
    const html = await render(ChartPanel, { title: '收支概览', points: [
      { value: 'INCOME', label: '总收入', amount: '100.00', itemCount: 1 },
      { value: 'EXPENSE', label: '原始支出', amount: '30.50', itemCount: 2 },
      { value: 'ADJUSTMENT', label: '退款/报销冲减', amount: '5.00', itemCount: 1 },
    ] })
    expect(html).toContain('<strong class="money-income">+¥100</strong>')
    expect(html).toContain('<strong class="money-expense">−¥30.50</strong>')
    expect(html).toContain('<strong class="money-income">+¥5</strong>')
    const props = { title: '排行', eyebrow: '支出分析', tone: 'expense', report: {
      dimension: 'PRODUCT', measureLabel: '原始支出', truncated: false,
      points: [{ group: '商品', label: '测试', value: 'test', amount: '30.00', itemCount: 1 }],
    } }
    expect(await render(ReportDimensionPanel, props)).toContain('<strong class="money-expense">¥30</strong>')
    props.report.dimension = 'FREQUENCY'
    const count = await render(ReportDimensionPanel, props)
    expect(count).toContain('30 条</strong>')
    expect(count).not.toContain('money-expense')
  })

  it('renders integral and fractional report comparisons without changing their direction', async () => {
    const report = { grain: 'MONTH', startDate: '2026-10-01', endDate: '2026-10-10', buckets: [],
      comparisons: [{ metric: 'BALANCE', currentAmount: '0.00',
        periodOverPeriod: { startDate: '2026-09-01', endDate: '2026-09-10', amount: '10.00', changePercent: '100.00' },
        yearOverYear: { startDate: '2025-10-01', endDate: '2025-10-10', amount: '20.00', changePercent: '-12.50' },
      }] }
    const html = await render(TimeTrendPanel, { metric: 'BALANCE', report })
    expect(html).toContain('增加 100% · 对比 ¥10')
    expect(html).toContain('减少 12.50% · 对比 ¥20')
    report.comparisons[0].periodOverPeriod.changePercent = '-0.00'
    expect(await render(TimeTrendPanel, { metric: 'BALANCE', report })).toContain('增加 0%')
  })

  it('renders a labeled dialog without inventing a second primary action', async () => {
    const dialog = await render(AppDialog, {
      id: 'delete-confirm', open: false, title: '确认删除', description: '删除后可在回收站恢复。',
    })
    expect(dialog).toContain('aria-labelledby="delete-confirm-title"')
    expect(dialog.match(/primary-button/g)).toHaveLength(1)

    const filter = await render(FilterSheet, { id: 'ledger-filter', open: false })
    expect(filter).toContain('调整中的条件只有在应用后')
    expect(filter).toContain('form="ledger-filter-form"')
  })

  it('renders reusable admin table and toast semantics', async () => {
    const tableApp = createSSRApp({
      render: () => h(AppDataTable, { caption: '普通用户账号' }, {
        head: () => h('tr', [h('th', '用户名')]),
        default: () => h('tr', [h('td', 'demo-user')]),
      }),
    })
    const table = await renderToString(tableApp)
    expect(table).toContain('<caption class="sr-only">普通用户账号</caption>')
    expect(table).toContain('<thead>')
    expect(table).toContain('<th>用户名</th>')

    const toast = await render(AppToast, { open: true, message: '账号状态已更新', kind: 'success' })
    expect(toast).toContain('role="status"')
    expect(toast).toContain('aria-live="polite"')
    expect(toast).toContain('账号状态已更新')

    const actionableToast = await render(AppToast, {
      open: true, message: '支出已保存', kind: 'success', actionLabel: '撤销', actionDisabled: true,
    })
    expect(actionableToast).toContain('撤销')
    expect(actionableToast).toContain('disabled')

    const errorToast = await render(AppToast, { open: true, message: '操作失败', kind: 'error' })
    expect(errorToast).toContain('role="alert"')
    expect(errorToast).toContain('aria-live="assertive"')
  })

  it('renders the same export state component for the ledger icon and settings row', async () => {
    const icon = await render(DataExportAction, { request: { scope: 'CURRENT_FILTERS', query: '', type: 'ALL',
      lifecycle: 'ACTIVE', range: 'TODAY' } })
    expect(icon).toContain('class="data-export-icon"')
    expect(icon).toContain('aria-label="导出数据"')

    const settings = await render(SettingsDisclosureList, { label: '数据与安全', items: [] })
    const settingAction = await render(DataExportAction, { request: { scope: 'ALL_DATA' }, presentation: 'setting' })
    expect(settings).toContain('数据与安全')
    expect(settingAction).toContain('导出全部数据')
    expect(settingAction).toContain('CSV · 24 小时有效')
  })

  it('renders grouped ledger items with explicit mixed-type and pagination semantics', async () => {
    const html = await render(IncrementalLedgerList, {
      type: 'ALL', lifecycle: 'ACTIVE', hasMore: true, loadingMore: false,
      items: [{ id: '10000000-0000-4000-8000-000000000001', entryType: 'INCOME',
        occurredAt: '2026-09-07T01:00:00Z', businessDate: '2026-09-07', title: '项目奖金',
        categoryName: '奖金', counterpartyName: '客户甲', fundingChannelName: '银行卡',
        amount: '88.80', note: '需要完整显示并自然换行的长备注内容', createdAt: '2026-09-07T01:00:00Z',
        adjustmentType: null, originalExpenseId: null, effectiveAdjustmentAmount: null,
        netExpenseAmount: null, fullyAdjusted: false, version: 0, lifecycleStatus: 'ACTIVE', linkedAdjustmentCount: 0 }],
    })
    expect(html).toContain('收入')
    expect(html).toContain('+¥88.80')
    expect(html).toContain('加载更多')
    expect(html).toContain('Shift+F10')
    expect(html).toContain('需要完整显示并自然换行的长备注内容')
  })

  it('groups non-contiguous pages for the same business date under one heading', async () => {
    const common = { entryType: 'INCOME', occurredAt: '2026-09-07T01:00:00Z', title: '项目奖金',
      categoryName: '奖金', counterpartyName: '客户甲', fundingChannelName: '银行卡', amount: '88.80',
      note: null, createdAt: '2026-09-07T01:00:00Z', adjustmentType: null, originalExpenseId: null,
      effectiveAdjustmentAmount: null, netExpenseAmount: null, fullyAdjusted: false, version: 0,
      lifecycleStatus: 'TRASHED', linkedAdjustmentCount: 0 }
    const html = await render(IncrementalLedgerList, {
      type: 'ALL', lifecycle: 'TRASHED', hasMore: false, loadingMore: false, items: [
        { ...common, id: '1', businessDate: '2026-09-07' },
        { ...common, id: '2', businessDate: '2026-09-06' },
        { ...common, id: '3', businessDate: '2026-09-07' },
      ],
    })
    expect(html.match(/9月7日/g)).toHaveLength(1)
    expect(html.match(/9月6日/g)).toHaveLength(1)
  })

  it('renders adjustment type and fully adjusted source state explicitly', async () => {
    const common = { occurredAt: '2026-09-07T01:00:00Z', businessDate: '2026-09-07',
      categoryName: '餐饮', fundingChannelName: '银行卡', note: null, createdAt: '2026-09-07T01:00:00Z' }
    const html = await render(IncrementalLedgerList, { type: 'ALL', lifecycle: 'ACTIVE', hasMore: false, loadingMore: false, items: [
      { ...common, id: '1', entryType: 'EXPENSE', title: '咖啡', counterpartyName: '1 杯', amount: '30.00',
        adjustmentType: null, originalExpenseId: null, effectiveAdjustmentAmount: '30.00', netExpenseAmount: '0.00', fullyAdjusted: true,
        version: 0, lifecycleStatus: 'ACTIVE', linkedAdjustmentCount: 1 },
      { ...common, id: '2', entryType: 'ADJUSTMENT', title: '退款', counterpartyName: '原支出 · 咖啡', amount: '30.00',
        adjustmentType: 'REFUND', originalExpenseId: '1', effectiveAdjustmentAmount: '30.00', netExpenseAmount: '0.00', fullyAdjusted: true,
        version: 0, lifecycleStatus: 'EFFECTIVE', linkedAdjustmentCount: 0 },
    ] })
    expect(html).toContain('已全额退款/报销')
    expect(html).toContain('退款')
    expect(html).toContain('+¥30</strong>')
  })

  it('renders recycle-bin expiry and linked cleanup impact without hiding it in color', async () => {
    const html = await render(IncrementalLedgerList, { type: 'ALL', lifecycle: 'TRASHED', hasMore: false,
      loadingMore: false, busyItemId: 'trash-1', items: [{
        id: 'trash-1', entryType: 'EXPENSE', occurredAt: '2026-09-07T01:00:00Z', businessDate: '2026-09-07',
        title: '咖啡', categoryName: '餐饮', counterpartyName: '1 杯', fundingChannelName: '银行卡', amount: '30.00',
        createdAt: '2026-09-07T01:00:00Z', adjustmentType: null, originalExpenseId: null,
        effectiveAdjustmentAmount: null, netExpenseAmount: null, fullyAdjusted: false, version: 1,
        lifecycleStatus: 'TRASHED', deletedAt: '2026-09-07T02:00:00Z', purgeAfter: '2026-10-07T02:00:00Z',
        remainingDays: 30, linkedAdjustmentCount: 2,
      }] })
    expect(html).toContain('回收站列表')
    expect(html).toContain('剩余 30 天')
    expect(html).toContain('联动清理 2 条调整')
    expect(html).toContain('aria-busy="true"')
  })
})
