import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readPrototype } from './contract-test.helpers.mjs'

const source = readPrototype('prototype.js')
const detailHtml = readPrototype('bill-details.html')
const loginHtml = readPrototype('login.html')
const profileHtml = readPrototype('profile-settings.html')

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
  { id: 'a2', type: 'adjustment', lifecycle: 'active', state: 'pending', name: '平台退款', amount: '36.00', linkedRecordId: '', occurredAt: '2026-08-13T11:00' }
]

assert.equal(context.filterLedgerRecords(records, { type: 'income', funding: 'funding-bank-card', keyword: '不存在', range: '本月' }).length, 0, '组合筛选必须真正消费关键词')
assert.deepEqual([...context.filterLedgerRecords(records, { type: 'income', funding: 'funding-bank-card', keyword: '示例公司', range: '本月' }).map(item => item.id)], ['i1'], '组合筛选必须同时消费类型、渠道、关键词与日期')
assert.deepEqual([...context.filterLedgerRecords(records, { scope: 'expense', funding: 'funding-wechat', range: '本月' }, { reportOnly: true }).map(item => item.id)], ['e1', 'a1'], '支出报表必须继承关联调整的资金渠道并排除待归类记录')
assert.equal(context.filterLedgerRecords(records, { scope: 'all', funding: '__all_funding_channels__', range: '上月' }, { reportOnly: true }).length, 0, '报表时间范围必须参与过滤')
assert.equal(context.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;', '用户业务文本进入图表前必须 HTML 编码')

for (const fragment of ['persistEntryFromScope', 'applyDetailFilters', 'resolveReportData', 'recordsForExport', 'moveRecordToTrash', 'restoreRecordFromTrash']) {
  assert(source.includes(fragment), `业务闭环缺少共享实现：${fragment}`)
}
for (const key of ['记录ID', '调整类型', '关联账目ID', '付款方', '一级分类', '资金渠道', '备注', '生命周期']) {
  assert(source.includes(`'${key}'`), `完整 CSV 缺少字段：${key}`)
}
assert(detailHtml.includes('data-detail-filter-key="keyword"'), '明细关键词必须进入可执行筛选状态')
assert(detailHtml.includes('data-record-id="expense-breakfast"'), '账单行必须绑定稳定记录 ID')
assert(!loginHtml.includes('data-close-after="已了解安装方式"'), 'PWA 安装不得保留提示型假按钮')
assert(loginHtml.includes('data-install-trigger') && profileHtml.includes('data-install-trigger'), '登录与“我的”必须复用同一 PWA 安装能力入口')
assert(source.includes('/^[=+\\-@]/.test(text)'), 'CSV 用户文本必须防止表格公式注入')

console.log('Business contract: OK')
