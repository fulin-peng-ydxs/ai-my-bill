import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readPrototype } from './contract-test.helpers.mjs'

const source = readPrototype('prototype.js')
const detailHtml = readPrototype('bill-details.html')
const loginHtml = readPrototype('login.html')
const profileHtml = readPrototype('profile-settings.html')
const reportsHtml = readPrototype('reports.html')

const memory = new Map()
const storage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key),
  clear: () => memory.clear()
}
const context = {
  console,
  URLSearchParams,
  Intl,
  Date,
  Math,
  Set,
  Map,
  BigInt,
  Blob,
  localStorage: storage,
  sessionStorage: storage,
  location: { search: '', pathname: '/prototype.html' },
  navigator: { userAgent: 'node-test' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  window: { addEventListener() {} },
  document: { addEventListener() {} }
}
context.globalThis = context
vm.createContext(context)
vm.runInContext(source, context)

const records = [
  { id: 'e1', type: 'expense', lifecycle: 'active', name: '早餐包', primaryCategory: '餐饮', amount: '28.00', fundingChannel: 'funding-wechat', occurredAt: '2026-08-13T08:00' },
  { id: 'i1', type: 'income', lifecycle: 'active', name: '工资', payer: '示例公司', category: '工资', amount: '8500.00', fundingChannel: 'funding-bank-card', occurredAt: '2026-08-13T09:00' },
  { id: 'a1', type: 'adjustment', lifecycle: 'active', state: 'active', name: '早餐退款', amount: '10.00', linkedRecordId: 'e1', occurredAt: '2026-08-13T10:00' },
]

assert.equal(context.filterLedgerRecords(records, { type: 'income', funding: 'funding-bank-card', keyword: '不存在', range: '本月' }).length, 0, '组合筛选必须真正消费关键词')
assert.deepEqual([...context.filterLedgerRecords(records, { type: 'income', funding: 'funding-bank-card', keyword: '示例公司', range: '本月' }).map(item => item.id)], ['i1'], '组合筛选必须同时消费类型、渠道、关键词与日期')
assert.deepEqual([...context.filterLedgerRecords(records, { scope: 'expense', funding: 'funding-wechat', range: '本月' }, { reportOnly: true }).map(item => item.id)], ['e1', 'a1'], '支出报表必须继承关联调整的资金渠道')
assert.equal(context.recordInRange(records[0], '今天'), true, '明细默认今天必须使用业务日期过滤')
assert.equal(context.recordInRange(records[0], '2026-08-01/2026-08-12'), false, '指定日期必须按完整起止范围过滤')
assert.equal(context.recordMatchesDrill(records[0], 'category', '餐饮'), true, '报表分类下钻必须约束到业务维度值')
assert.equal(context.recordMatchesDrill(records[1], 'type', '原始支出'), false, '报表总览下钻不得产生收入范围与支出值矛盾')
assert.equal(context.filterLedgerRecords(records, { scope: 'all', funding: '__all_funding_channels__', range: '上月' }, { reportOnly: true }).length, 0, '报表时间范围必须参与过滤')
assert.equal(context.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;', '用户业务文本进入图表前必须 HTML 编码')

for (const fragment of ['persistEntryFromScope', 'applyDetailFilters', 'resolveReportData', 'recordsForExport', 'moveRecordToTrash', 'restoreRecordFromTrash']) {
  assert(source.includes(fragment), `业务闭环缺少共享实现：${fragment}`)
}
for (const key of ['记录ID', '调整类型', '关联账目ID', '付款方', '一级分类', '资金渠道', '备注', '生命周期']) {
  assert(source.includes(`'${key}'`), `完整 CSV 缺少字段：${key}`)
}
assert(detailHtml.includes('data-detail-global-search') && !detailHtml.includes('data-detail-filter-key="keyword"'), '明细关键词必须常驻页面且不得埋入筛选抽屉')
assert(detailHtml.includes('data-ledger-load-more') && source.includes('detailVisibleLimit = 20'), '大范围明细必须按 20 笔分批加载')
assert(detailHtml.includes('data-ledger-action="adjustment"') && !detailHtml.includes('unlinked-adjustment-sheet'), '退款/报销必须从具体账目上下文发起')
assert(detailHtml.includes('data-record-id="expense-breakfast"'), '账单行必须绑定稳定记录 ID')
assert(!loginHtml.includes('data-close-after="已了解安装方式"'), 'PWA 安装不得保留提示型假按钮')
assert(loginHtml.includes('data-install-trigger') && profileHtml.includes('data-install-trigger'), '登录与“我的”必须复用同一 PWA 安装能力入口')
assert(source.includes('/^[=+\\-@]/.test(text)'), 'CSV 用户文本必须防止表格公式注入')
assert(/data-state-region="report"[\s\S]*?data-balance-summary[\s\S]*?data-report-view/.test(reportsHtml), '报表 empty/loading 必须同时接管摘要、图表和排行，不能残留非零汇总')
assert(source.includes("if (state === 'loading' || state === 'empty') [...target.children].forEach"), '页面 empty/loading 状态必须隐藏所属业务区域的 ready 内容')
assert(source.includes("if (document.querySelector('[data-state-region=\"report\"] > .region-state')) return"), '报表初始化不得在强制 empty/loading 状态后重新显示非零摘要')

console.log('Business contract: OK')
