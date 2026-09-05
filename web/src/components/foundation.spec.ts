import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'

import AppDialog from './AppDialog.vue'
import AppStateBlock from './AppStateBlock.vue'
import AppliedFilterBar from './AppliedFilterBar.vue'
import FilterSheet from './FilterSheet.vue'
import FormField from './FormField.vue'
import GlobalLedgerSearch from './GlobalLedgerSearch.vue'
import MoneySummary from './MoneySummary.vue'
import SegmentedControl from './SegmentedControl.vue'
import SettingsDisclosureList from './SettingsDisclosureList.vue'

async function render(component: Parameters<typeof h>[0], props?: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}

describe('shared frontend foundations', () => {
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

    const filters = await render(AppliedFilterBar, { summaries: ['本月', '仅支出'] })
    expect(filters).toContain('本月')
    expect(filters).toContain('清除全部筛选')
  })

  it('renders exact signed money semantics and stable settings disclosure values', async () => {
    const money = await render(MoneySummary, { items: [
      { key: 'income', label: '收入', amount: '1234.5', tone: 'income', sign: '+' },
      { key: 'expense', label: '支出', amount: '20', tone: 'expense', sign: '-' },
    ] })
    expect(money).toContain('+¥1,234.50')
    expect(money).toContain('-¥20.00')
    expect(money).toContain('正')
    expect(money).toContain('负')

    const settings = await render(SettingsDisclosureList, {
      label: '偏好设置', items: [{ key: 'theme', label: '外观', value: '跟随系统' }],
    })
    expect(settings).toContain('偏好设置')
    expect(settings).toContain('跟随系统')
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
})
