const icons = {
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10m-7 6h4"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18 12a6 6 0 0 0-10.2-4.3L4 12m2 0a6 6 0 0 0 10.2 4.3L20 12"/></svg>'
}

const preferenceStorageKey = 'bill-prototype-preferences'
const preferenceSessionKey = 'bill-prototype-preference-session'
const fundingDictionaryStorageKey = 'bill-prototype-funding-dictionary'
const dailyTemplateStorageKey = 'bill-prototype-daily-templates'
const ledgerStorageKey = 'bill-prototype-ledger'
const detailFilterStorageKey = 'bill-prototype-detail-filter'
const fundingFilterAllValue = '__all_funding_channels__'
const fundingManagementLabel = '管理资金渠道'
const reservedFundingIds = new Set([fundingFilterAllValue])
const fundingDictionaryDefaults = Object.freeze([
  { id: 'funding-wechat', name: '微信', enabled: true },
  { id: 'funding-alipay', name: '支付宝', enabled: true },
  { id: 'funding-bank-card', name: '银行卡', enabled: true },
  { id: 'funding-cash', name: '现金', enabled: true }
])
const preferenceDefaults = Object.freeze({
  fundingChannel: 'funding-wechat',
  detailRange: '今天',
  reportRange: '本月',
  entryType: 'expense',
  theme: 'system'
})

const ledgerDefaults = Object.freeze([
  { id: 'income-salary', type: 'income', lifecycle: 'active', name: '8 月工资', payer: '示例科技有限公司', category: '工资', amount: '8500.00', fundingChannel: 'funding-bank-card', occurredAt: '2026-08-13T09:00', note: '' },
  { id: 'expense-breakfast', type: 'expense', lifecycle: 'active', name: '早餐包', primaryCategory: '餐饮', secondaryCategory: '早餐', unit: '个', price: '14.00', quantity: '2', amount: '28.00', fundingChannel: 'funding-wechat', purchaseChannel: '商超', location: '家附近超市', occurredAt: '2026-08-13T08:12', note: '早市优惠' },
  { id: 'adjustment-breakfast', type: 'adjustment', adjustmentType: '消费退款', lifecycle: 'active', state: 'active', name: '早餐包部分退款', amount: '10.00', linkedRecordId: 'expense-breakfast', occurredAt: '2026-08-13T10:20', note: '商家部分退款' },
  { id: 'income-parttime', type: 'income', lifecycle: 'active', name: '项目兼职', payer: '客户李先生', category: '兼职', amount: '1100.00', fundingChannel: 'funding-wechat', occurredAt: '2026-08-10T18:30', note: '' },
  { id: 'expense-umbrella', type: 'expense', lifecycle: 'trash', name: '旧雨伞', primaryCategory: '日用', secondaryCategory: '', unit: '把', price: '58.00', quantity: '1', amount: '58.00', fundingChannel: 'funding-alipay', purchaseChannel: '商超', location: '', occurredAt: '2026-08-03T14:00', note: '' },
  { id: 'adjustment-umbrella', type: 'adjustment', adjustmentType: '费用报销', lifecycle: 'trash', state: 'frozen', name: '旧雨伞报销', amount: '20.00', linkedRecordId: 'expense-umbrella', occurredAt: '2026-08-04T09:00', note: '' },
  { id: 'income-test', type: 'income', lifecycle: 'trash', name: '测试收入', payer: '测试付款方', category: '其他收入', amount: '1.00', fundingChannel: 'funding-cash', occurredAt: '2026-07-30T09:00', note: '' }
])

function readLedgerRecords() {
  let stored = null
  try { stored = JSON.parse(sessionStorage.getItem(ledgerStorageKey) || 'null') } catch (error) { stored = null }
  return (Array.isArray(stored) ? stored : ledgerDefaults).map(record => ({ ...record }))
}

function writeLedgerRecords(records) {
  sessionStorage.setItem(ledgerStorageKey, JSON.stringify(records))
  sessionStorage.setItem('bill-prototype-report-invalidated-at', String(Date.now()))
  return records
}

function updateLedgerRecord(recordId, patch) {
  const records = readLedgerRecords()
  const index = records.findIndex(record => record.id === recordId)
  if (index < 0) return null
  records[index] = { ...records[index], ...patch }
  writeLedgerRecords(records)
  return records[index]
}

function recordFundingChannel(record, records = readLedgerRecords()) {
  if (record.fundingChannel) return record.fundingChannel
  return records.find(item => item.id === record.linkedRecordId)?.fundingChannel || ''
}

function recordSearchText(record, records = readLedgerRecords()) {
  const linked = records.find(item => item.id === record.linkedRecordId)
  return [record.name, record.payer, record.category, record.primaryCategory, record.secondaryCategory,
    record.purchaseChannel, record.location, record.note, linked?.name, linked?.primaryCategory]
    .filter(Boolean).join(' ').toLocaleLowerCase('zh-CN')
}

function recordMatchesDrill(record, dimension, value) {
  if (!dimension || !value || ['all', 'balance', 'overview'].includes(dimension)) return true
  if (dimension === 'type') {
    if (value.includes('收入')) return record.type === 'income'
    if (value.includes('支出')) return record.type === 'expense'
    return true
  }
  if (dimension === 'adjustment') return record.type === 'adjustment'
  if (['trend', 'incomeTrend'].includes(dimension)) return `${Number(record.occurredAt?.slice(8, 10) || 0)}日` === value
  if (dimension === 'category') return (record.primaryCategory || '未分类') === value
  if (dimension === 'incomeCategory') return (record.category || '未分类') === value
  if (['product', 'incomeName', 'frequency', 'incomeFrequency'].includes(dimension)) return record.name === value
  if (dimension === 'payer') return (record.payer || '未填写') === value
  if (['payment', 'receiving'].includes(dimension)) return getFundingChannelName(record.fundingChannel) === value
  if (dimension === 'channel') return (record.purchaseChannel || '未指定') === value
  if (dimension === 'location') return (record.location || '未指定') === value
  if (dimension === 'price') return `${record.name}/${record.unit || '次'}` === value
  if (dimension === 'habit') return new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(record.occurredAt)) === value
  return true
}

function recordInRange(record, range) {
  const date = String(record.occurredAt || '').slice(0, 10)
  if (!date || !range) return true
  if (range.includes('/')) {
    const [start, end] = range.split('/')
    return date >= start && date <= end
  }
  const named = {
    今天: ['2026-08-13', '2026-08-13'],
    本周: ['2026-08-10', '2026-08-16'],
    本月: ['2026-08-01', '2026-08-31'],
    上月: ['2026-07-01', '2026-07-31'],
    今年: ['2026-01-01', '2026-12-31']
  }[range]
  return !named || (date >= named[0] && date <= named[1])
}

function rangeDisplayLabel(range) {
  if (!range?.includes('/')) return range || '今天'
  const [start, end] = range.split('/')
  return start === end ? start : `${start} 至 ${end}`
}

function readRangeControl(select, start, end) {
  if (!select || select.value !== 'custom') return select?.value || '今天'
  const from = start?.value || ''
  const to = end?.value || ''
  return from && to && from <= to ? `${from}/${to}` : ''
}

function restoreRangeControl(select, start, end, range) {
  if (!select) return
  const named = [...select.options].some(option => option.value === range)
  select.value = named ? range : 'custom'
  if (!named && range?.includes('/')) [start.value, end.value] = range.split('/')
  const custom = select.closest('.overlay')?.querySelector(select.matches('[data-report-range]') ? '[data-report-custom-range]' : '[data-detail-custom-range]')
  if (custom) custom.hidden = select.value !== 'custom'
}

function setRangeValidation(select, start, end) {
  const custom = select?.closest('.overlay')?.querySelector(select.matches('[data-report-range]') ? '[data-report-custom-range]' : '[data-detail-custom-range]')
  if (custom) custom.hidden = select.value !== 'custom'
  const valid = select?.value !== 'custom' || Boolean(start?.value && end?.value && start.value <= end.value)
  custom?.classList.toggle('invalid', !valid)
  const error = custom?.querySelector('[data-range-error]')
  if (error) error.hidden = valid
  return valid
}

function filterLedgerRecords(records, filters = {}, { lifecycle = 'active', reportOnly = false } = {}) {
  const type = filters.type || filters.scope || 'all'
  const keyword = String(filters.keyword || filters.expenseQuery || filters.incomeQuery || '').trim().toLocaleLowerCase('zh-CN')
  const funding = filters.funding || fundingFilterAllValue
  return records.filter(record => {
    if (record.lifecycle !== lifecycle) return false
    if (reportOnly && record.type === 'adjustment' && record.state !== 'active') return false
    if (type !== 'all' && record.type !== type && !(reportOnly && type === 'expense' && record.type === 'adjustment' && record.state === 'active')) return false
    if (!recordInRange(record, filters.range)) return false
    if (funding !== fundingFilterAllValue && recordFundingChannel(record, records) !== funding) return false
    if (filters.expenseCategory && filters.expenseCategory !== '全部支出分类') {
      const source = record.type === 'adjustment' ? records.find(item => item.id === record.linkedRecordId) : record
      if (source?.primaryCategory !== filters.expenseCategory) return false
    }
    if (filters.incomeCategory && filters.incomeCategory !== '全部收入分类' && record.category !== filters.incomeCategory) return false
    if (!recordMatchesDrill(record, filters.drillDimension, filters.drillValue)) return false
    return !keyword || recordSearchText(record, records).includes(keyword)
  })
}
const preferenceOptions = {
  detailRange: ['今天', '本周', '本月', '上月', '今年'],
  reportRange: ['今天', '本周', '本月', '上月', '今年'],
  entryType: ['expense', 'income'],
  theme: ['system', 'light', 'dark']
}

const dailyTemplateDefaults = Object.freeze([
  { id: 'daily-expense-breakfast', type: 'expense', name: '早餐包', primaryCategory: '餐饮', secondaryCategory: '早餐', unit: '个', price: '14.00', quantity: '2', paid: '28.00', fundingChannel: 'funding-wechat', purchaseChannel: '商超', location: '家附近超市', sourceRecordId: 'expense-breakfast', updatedAt: 2 },
  { id: 'daily-income-salary', type: 'income', name: '8 月工资', payer: '示例科技有限公司', category: '工资', amount: '8500.00', fundingChannel: 'funding-bank-card', sourceRecordId: 'income-salary', updatedAt: 1 }
])

function normalizeDailyTemplateKey(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

function createDailyTemplateId(type) {
  if (globalThis.crypto?.randomUUID) return `daily-${type}-${globalThis.crypto.randomUUID()}`
  return `daily-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeDailyTemplates(raw) {
  const source = Array.isArray(raw) ? raw : dailyTemplateDefaults
  const seen = new Set()
  return source.flatMap(item => {
    const type = item?.type === 'income' ? 'income' : item?.type === 'expense' ? 'expense' : ''
    const name = typeof item?.name === 'string' ? item.name.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
    const key = `${type}:${normalizeDailyTemplateKey(name)}`
    if (!type || !name || seen.has(key)) return []
    seen.add(key)
    const text = field => typeof item[field] === 'string' ? item[field].trim() : ''
    const normalized = {
      id: typeof item.id === 'string' && item.id ? item.id : createDailyTemplateId(type),
      type,
      key: normalizeDailyTemplateKey(name),
      name,
      fundingChannel: resolveFundingChannelId(item.fundingChannel, false) || '',
      sourceRecordId: text('sourceRecordId'),
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : 0
    }
    if (type === 'expense') Object.assign(normalized, {
      primaryCategory: text('primaryCategory'), secondaryCategory: text('secondaryCategory'), unit: text('unit'),
      price: text('price'), quantity: text('quantity'), paid: text('paid'), purchaseChannel: text('purchaseChannel'), location: text('location')
    })
    if (type === 'income') Object.assign(normalized, { payer: text('payer'), category: text('category'), amount: text('amount') })
    return [normalized]
  })
}

function readDailyTemplates() {
  let stored = null
  try { stored = JSON.parse(localStorage.getItem(dailyTemplateStorageKey) || 'null') } catch (error) { stored = null }
  return normalizeDailyTemplates(stored)
}

function writeDailyTemplates(items) {
  const normalized = normalizeDailyTemplates(items)
  localStorage.setItem(dailyTemplateStorageKey, JSON.stringify(normalized))
  return normalized
}

function legacyFundingChannelId(name, index = 0) {
  let hash = 2166136261
  for (const character of name) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `funding-legacy-${(hash >>> 0).toString(36)}-${index}`
}

function createFundingChannelId() {
  if (globalThis.crypto?.randomUUID) return `funding-${globalThis.crypto.randomUUID()}`
  return `funding-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeFundingDictionary(raw) {
  if (!Array.isArray(raw)) return fundingDictionaryDefaults.map(item => ({ ...item }))
  const seenNames = new Set()
  const seenIds = new Set()
  const items = raw.flatMap((item, index) => {
    const name = typeof item?.name === 'string' ? item.name.trim() : ''
    if (!name || seenNames.has(name)) return []
    seenNames.add(name)
    const defaultItem = fundingDictionaryDefaults.find(candidate => candidate.name === name)
    let id = typeof item?.id === 'string' ? item.id.trim() : ''
    if (!id || reservedFundingIds.has(id) || seenIds.has(id)) id = defaultItem?.id || legacyFundingChannelId(name, index)
    while (seenIds.has(id)) id = `${legacyFundingChannelId(name, index)}-${seenIds.size}`
    seenIds.add(id)
    return [{ id, name, enabled: item.enabled !== false }]
  })
  if (!items.length || !items.some(item => item.enabled)) return fundingDictionaryDefaults.map(item => ({ ...item }))
  return items
}

function readFundingDictionary() {
  let stored = null
  try { stored = JSON.parse(localStorage.getItem(fundingDictionaryStorageKey) || 'null') } catch (error) { stored = null }
  const simulateInvalid = new URLSearchParams(location.search).get('funding') === 'invalid'
  if (simulateInvalid) stored = [{ name: '', enabled: true }, { name: '微信', enabled: false }]
  const normalized = normalizeFundingDictionary(stored)
  if (!simulateInvalid && Array.isArray(stored) && JSON.stringify(stored) !== JSON.stringify(normalized)) {
    localStorage.setItem(fundingDictionaryStorageKey, JSON.stringify(normalized))
  }
  return normalized
}

function writeFundingDictionary(items) {
  const normalized = normalizeFundingDictionary(items)
  localStorage.setItem(fundingDictionaryStorageKey, JSON.stringify(normalized))
  return normalized
}

function getEnabledFundingChannels() {
  return readFundingDictionary().filter(item => item.enabled)
}

function getDefaultFundingChannel() {
  const enabled = getEnabledFundingChannels()
  return enabled.some(item => item.id === preferenceDefaults.fundingChannel) ? preferenceDefaults.fundingChannel : enabled[0].id
}

function resolveFundingChannelId(value, enabledOnly = true) {
  const dictionary = readFundingDictionary().filter(item => !enabledOnly || item.enabled)
  return dictionary.find(item => item.id === value || item.name === value)?.id || ''
}

function getFundingChannelName(id) {
  const dictionary = readFundingDictionary()
  return dictionary.find(item => item.id === id)?.name || dictionary.find(item => item.enabled)?.name || '未设置'
}

function isValidPreference(key, value) {
  return key === 'fundingChannel' ? Boolean(resolveFundingChannelId(value)) : preferenceOptions[key].includes(value)
}
const reportRangeValues = {
  今天: '今天',
  本周: '本周',
  本月: '本月',
  上月: '上月',
  今年: '今年'
}

function normalizePreferences(raw = {}) {
  return Object.fromEntries(Object.entries(preferenceDefaults).map(([key, fallback]) => [
    key,
    key === 'fundingChannel'
      ? resolveFundingChannelId(raw[key]) || getDefaultFundingChannel()
      : isValidPreference(key, raw[key]) ? raw[key] : fallback
  ]))
}

function readPreferenceSessionState() {
  let raw = {}
  try { raw = JSON.parse(sessionStorage.getItem(preferenceSessionKey) || '{}') } catch (error) { raw = {} }
  const normalized = Object.fromEntries(Object.entries(raw).flatMap(([key, item]) => {
    if (!(key in preferenceDefaults)) return []
    const value = typeof item === 'object' && item !== null ? item.value : item
    if (!isValidPreference(key, value)) return []
    const status = typeof item === 'object' && ['pending', 'error'].includes(item.status) ? item.status : 'error'
    return [[key, { value: key === 'fundingChannel' ? resolveFundingChannelId(value) : value, status }]]
  }))
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    if (Object.keys(normalized).length) sessionStorage.setItem(preferenceSessionKey, JSON.stringify(normalized))
    else sessionStorage.removeItem(preferenceSessionKey)
  }
  return normalized
}

function readStoredPreferences() {
  let stored = {}
  try { stored = JSON.parse(localStorage.getItem(preferenceStorageKey) || '{}') } catch (error) { stored = {} }
  const legacyEntryType = localStorage.getItem('bill-prototype-entry-type')
  const themeCache = localStorage.getItem('bill-prototype-theme')
  const normalized = normalizePreferences({
    ...stored,
    entryType: stored.entryType || legacyEntryType,
    theme: stored.theme || themeCache
  })
  const hasLegacySource = Boolean(Object.keys(stored).length || legacyEntryType || themeCache)
  if (hasLegacySource && JSON.stringify(stored) !== JSON.stringify(normalized)) {
    localStorage.setItem(preferenceStorageKey, JSON.stringify(normalized))
  }
  if (legacyEntryType) localStorage.removeItem('bill-prototype-entry-type')
  return normalized
}

function getPreferences() {
  return getPreferenceState().values
}

function getPreferenceState() {
  const saved = readStoredPreferences()
  const sessionState = readPreferenceSessionState()
  if (new URLSearchParams(location.search).get('preference') === 'invalid') {
    const values = normalizePreferences({ fundingChannel: '已停用渠道', detailRange: '未来一年', reportRange: '任意时间', entryType: 'transfer', theme: 'contrast' })
    return { values, fields: Object.fromEntries(Object.keys(preferenceDefaults).map(key => [key, { value: values[key], savedValue: saved[key], status: 'saved' }])) }
  }
  const values = normalizePreferences({ ...saved, ...Object.fromEntries(Object.entries(sessionState).map(([key, item]) => [key, item.value])) })
  const fields = Object.fromEntries(Object.keys(preferenceDefaults).map(key => [key, {
    value: values[key],
    savedValue: saved[key],
    status: sessionState[key]?.status || 'saved'
  }]))
  return { values, fields }
}

function updatePreferences(patch) {
  const next = normalizePreferences({ ...readStoredPreferences(), ...patch })
  localStorage.setItem(preferenceStorageKey, JSON.stringify(next))
  localStorage.removeItem('bill-prototype-entry-type')
  if (patch.theme) localStorage.setItem('bill-prototype-theme', next.theme)
  const sessionState = readPreferenceSessionState()
  Object.keys(patch).forEach(key => { delete sessionState[key] })
  if (Object.keys(sessionState).length) sessionStorage.setItem(preferenceSessionKey, JSON.stringify(sessionState))
  else sessionStorage.removeItem(preferenceSessionKey)
  return getPreferences()
}

function stagePreferences(patch, status = 'pending') {
  const sessionState = readPreferenceSessionState()
  const normalized = normalizePreferences({ ...getPreferences(), ...patch })
  Object.keys(patch).forEach(key => { sessionState[key] = { value: normalized[key], status } })
  sessionStorage.setItem(preferenceSessionKey, JSON.stringify(sessionState))
}

function markPreferenceErrors(patch) {
  stagePreferences(patch, 'error')
}

function shouldFailPreferenceOnce(button) {
  const shouldFail = new URLSearchParams(location.search).get('preference') === 'error' && button.dataset.failureShown !== 'true'
  if (shouldFail) button.dataset.failureShown = 'true'
  return shouldFail
}

function savePreference(button, patch, { loadingText = '保存中…', optimistic = true, controls = [button], replaceLabel = true, onPending, onSuccess, onFailure } = {}) {
  if (!button || button.dataset.preferenceState === 'running') return
  if (optimistic) {
    stagePreferences(patch)
    onPending?.(getPreferenceState())
  }
  button.dataset.preferenceState = 'running'
  controls.forEach(control => {
    if (replaceLabel && control === button) setButtonLoading(control, true, loadingText)
    else control.disabled = true
  })
  setTimeout(() => {
    button.dataset.preferenceState = 'idle'
    controls.forEach(control => {
      if (replaceLabel && control === button) setButtonLoading(control, false)
      else control.disabled = false
    })
    if (shouldFailPreferenceOnce(button)) {
      if (optimistic) markPreferenceErrors(patch)
      return onFailure?.(getPreferenceState())
    }
    const preferences = updatePreferences(patch)
    onSuccess?.(preferences)
  }, 650)
}

function resolveTheme(mode) {
  return mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode
}

function applyTheme(mode) {
  const safeMode = ['system', 'light', 'dark'].includes(mode) ? mode : 'system'
  const resolved = resolveTheme(safeMode)
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themeMode = safeMode
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#000000' : '#F5F5F7')
  document.querySelectorAll('button[data-theme-mode]').forEach(button => {
    const active = button.dataset.themeMode === safeMode
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  localStorage.setItem('bill-prototype-theme', safeMode)
}

function initTheme() {
  applyTheme(getPreferences().theme)
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (document.documentElement.dataset.themeMode === 'system') applyTheme('system')
  })
}

function initIcons() {
  document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icons[element.dataset.icon] || '' })
}

function closeOverlay(overlay) {
  if (!overlay) return
  overlay.classList.remove('open')
  document.body.style.overflow = document.querySelector('.overlay.open') ? 'hidden' : ''
}

function openOverlay(id) {
  const overlay = document.getElementById(id)
  if (!overlay) return
  overlay.classList.add('open')
  document.body.style.overflow = 'hidden'
  overlay.querySelector('input, select, button')?.focus()
}

function bindOverlayTrigger(trigger) {
  if (!trigger || trigger.dataset.overlayBound === 'true') return
  trigger.dataset.overlayBound = 'true'
  trigger.addEventListener('click', () => {
    const overlay = document.getElementById(trigger.dataset.open)
    if (overlay) overlay.__sourceTrigger = trigger
    const sourceOverlay = trigger.closest('.overlay')
    if (sourceOverlay && sourceOverlay !== overlay) closeOverlay(sourceOverlay)
    openOverlay(trigger.dataset.open)
  })
}

function initOverlays() {
  document.querySelectorAll('[data-open]').forEach(bindOverlayTrigger)
  document.querySelectorAll('[data-close]').forEach(trigger => trigger.addEventListener('click', () => closeOverlay(trigger.closest('.overlay'))))
  document.querySelectorAll('.overlay').forEach(overlay => overlay.addEventListener('click', event => {
    if (event.target === overlay) closeOverlay(overlay)
  }))
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeOverlay(document.querySelector('.overlay.open'))
  })
}

function showToast(message) {
  let toast = document.querySelector('.toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.className = 'toast'
    toast.setAttribute('role', 'status')
    document.body.appendChild(toast)
  }
  toast.textContent = message
  toast.classList.add('show')
  clearTimeout(window.__toastTimer)
  window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 2300)
}

function setButtonLoading(button, loading, loadingText) {
  if (!button) return
  if (loading && !button.dataset.originalText) button.dataset.originalText = button.textContent
  button.disabled = loading
  button.textContent = loading ? loadingText : button.dataset.originalText || button.textContent
  if (!loading) delete button.dataset.originalText
}

function getActiveFormControls(scope) {
  return [...scope.querySelectorAll('input, select, textarea')].filter(control => {
    const conditionalField = control.closest('[data-filter-for]')
    return !control.disabled && !conditionalField?.hidden
  })
}

function getFundingChannelDisplayName(channel, context = 'default') {
  if (context === 'filter' && channel.name === '全部渠道') return '全部渠道（资金渠道）'
  if (context === 'picker' && channel.name === fundingManagementLabel) return `${channel.name}（渠道）`
  return channel.name
}

function createFundingChip(channel, context = 'default') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'chip'
  button.dataset.fundingId = channel.id
  button.textContent = getFundingChannelDisplayName(channel, context)
  button.setAttribute('aria-label', `选择资金渠道：${channel.name}`)
  return button
}

function renderFundingControls() {
  const enabledChannels = getEnabledFundingChannels()
  document.querySelectorAll('[data-preference-options="fundingChannel"]').forEach(group => {
    delete group.dataset.chipBound
    group.replaceChildren(...enabledChannels.map(channel => createFundingChip(channel)))
  })
  document.querySelectorAll('[data-funding-picker]').forEach(group => {
    delete group.dataset.chipBound
    group.replaceChildren(...enabledChannels.map(channel => createFundingChip(channel, 'picker')))
  })
  document.querySelectorAll('[data-funding-filter]').forEach(select => {
    const selected = select.value
    const all = document.createElement('option')
    all.value = fundingFilterAllValue
    all.textContent = '全部渠道'
    select.replaceChildren(all, ...enabledChannels.map(channel => {
      const option = document.createElement('option')
      option.value = channel.id
      option.textContent = getFundingChannelDisplayName(channel, 'filter')
      return option
    }))
    const selectedId = resolveFundingChannelId(selected)
    select.value = selected === fundingFilterAllValue || selected === '全部渠道' ? fundingFilterAllValue : selectedId || fundingFilterAllValue
  })
  document.querySelectorAll('[data-funding-select]').forEach(select => {
    select.required = true
    select.dataset.required = ''
    const selected = select.value || select.dataset.fundingInitial
    select.replaceChildren(...enabledChannels.map(channel => {
      const option = document.createElement('option')
      option.value = channel.id
      option.textContent = channel.name
      return option
    }))
    select.value = resolveFundingChannelId(selected) || getDefaultFundingChannel()
  })
  const count = document.querySelector('[data-funding-dictionary-count]')
  if (count) count.textContent = `${readFundingDictionary().length} 项`
  document.querySelectorAll('[data-chip-group]').forEach(bindChipGroup)
  document.querySelectorAll('[data-open="funding-sheet"]').forEach(bindOverlayTrigger)
}

function bindChipGroup(group) {
  if (!group || group.dataset.chipBound === 'true') return
  group.dataset.chipBound = 'true'
  group.querySelectorAll('.chip:not([data-open])').forEach(chip => chip.addEventListener('click', () => {
    group.querySelectorAll('.chip').forEach(item => {
      item.classList.toggle('active', item === chip)
      item.setAttribute('aria-pressed', String(item === chip))
    })
  }))
}

function initCommonActions() {
  document.querySelectorAll('[data-toast]').forEach(trigger => trigger.addEventListener('click', () => showToast(trigger.dataset.toast)))
  document.querySelectorAll('button[data-theme-mode]').forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.themeMode
    applyTheme(mode)
    const status = document.querySelector('[data-theme-save-status]')
    if (!status) return updatePreferences({ theme: mode })
    const buttons = [...document.querySelectorAll('button[data-theme-mode]')]
    status.textContent = '保存中…'
    savePreference(button, { theme: mode }, {
      controls: buttons,
      replaceLabel: false,
      onFailure: () => {
        status.textContent = '保存失败，当前主题继续使用；点击可重试'
      },
      onSuccess: () => {
        status.textContent = '已保存并跨页面生效'
        closeOverlay(button.closest('.overlay'))
      }
    })
  }))
  document.querySelectorAll('[data-chip-group]').forEach(bindChipGroup)
  document.querySelectorAll('[data-close-after]').forEach(button => button.addEventListener('click', () => {
    showToast(button.dataset.closeAfter)
    closeOverlay(button.closest('.overlay'))
  }))
}

function initPageState() {
  const content = document.querySelector('[data-page-content]')
  if (!content) return
  const params = new URLSearchParams(location.search)
  const state = params.get('state') || 'ready'
  if (state === 'ready') return
  const page = document.body.dataset.page || 'generic'
  if (page === 'login' && state === 'empty') return
  const definitions = {
    loading: ['正在加载', '正在读取最新数据，请稍候。', ''],
    empty: ['暂时没有数据', '当前区域还没有可展示的内容。', '去记一笔'],
    error: ['数据加载失败', '网络或服务暂时不可用，请重试。', '重新加载'],
    permission: ['无权访问', '当前账号没有访问此页面的权限。', '返回登录']
  }
  const selected = definitions[state] || definitions.error
  if (state === 'permission') {
    const shell = document.querySelector('.admin-shell, .app, .auth-shell')
    if (shell) shell.hidden = true
  }
  const defaultRegions = { reports: 'report', details: 'ledger', profile: 'dictionary', admin: 'admin' }
  const regionName = params.get('region') || defaultRegions[page]
  const emptyCopy = {
    report: ['暂无可统计账目', '当前范围没有有效收支；可调整筛选或先记一笔。', '去记一笔'],
    ledger: ['当前条件没有明细', '切换账目类型或清除筛选后再试。', '清除筛选'],
    dictionary: ['尚无字典项', '新增第一项后即可在填报中快速选择。', '新增一项'],
    admin: ['没有匹配的管理数据', '调整搜索或状态筛选后再试。', '清除筛选']
  }
  if (state === 'empty' && emptyCopy[regionName]) selected.splice(0, selected.length, ...emptyCopy[regionName])
  const region = regionName ? document.querySelector(`[data-state-region="${regionName}"]`) : null
  if (state !== 'permission' && region?.closest('.overlay')) openOverlay(region.closest('.overlay').id)
  const target = state === 'permission' ? document.body : !region ? content.parentElement : region
  const block = document.createElement('section')
  block.className = `state region-state ${state === 'error' || state === 'permission' ? 'error' : ''}`
  const href = state === 'empty' && regionName === 'report' ? 'expense-entry.html' : state === 'permission' ? 'login.html' : `${location.pathname.split('/').pop()}`
  block.innerHTML = `<div class="state-stack"><div><strong>${selected[0]}</strong><span>${selected[1]}</span></div>${selected[2] ? `<a class="btn ${state === 'error' ? 'primary' : ''}" href="${href}">${selected[2]}</a>` : '<div class="skeleton-line" aria-hidden="true"></div>'}</div>`
  if (state === 'loading' || state === 'empty') [...target.children].forEach(child => { child.hidden = true })
  target.prepend(block)
}

function initFormAccessibility() {
  const page = document.body.dataset.page || 'page'
  let index = 0
  const nextId = kind => {
    let id = ''
    do { id = `${page}-${kind}-${++index}` } while (document.getElementById(id))
    return id
  }
  document.querySelectorAll('.field').forEach(field => {
    const label = field.querySelector(':scope > label, :scope > .field-label-row > label')
    if (!label || label.htmlFor) return
    const control = field.querySelector(':scope > .control, :scope > .input-prefix > .control')
    if (control) {
      if (!control.id) control.id = nextId('field')
      label.htmlFor = control.id
      return
    }
    const group = field.querySelector(':scope > .chip-row, :scope > .field-label-row + .chip-row')
    if (!group) return
    if (!label.id) label.id = nextId('group')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-labelledby', label.id)
  })
  const standaloneNames = new Map([
    ['[data-user-search]', '搜索用户名'],
    ['[data-user-status-filter]', '筛选用户状态']
  ])
  standaloneNames.forEach((name, selector) => document.querySelectorAll(selector).forEach(control => control.setAttribute('aria-label', name)))
}

let deferredInstallPrompt = null
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  deferredInstallPrompt = event
  document.dispatchEvent(new CustomEvent('pwa-install-capability'))
})

function mountPwaInstallSheet() {
  if (!document.querySelector('[data-install-trigger], [data-open="install-sheet"]')) return
  document.querySelectorAll('[data-open="install-sheet"]').forEach(trigger => {
    trigger.dataset.installTrigger = ''
    delete trigger.dataset.open
  })
  if (document.getElementById('install-sheet')) document.getElementById('install-sheet').remove()
  const overlay = document.createElement('div')
  overlay.className = 'overlay'
  overlay.id = 'install-sheet'
  overlay.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="install-title"><div class="sheet-handle"></div><div class="sheet-head"><h2 class="sheet-title" id="install-title">安装到手机桌面</h2><button class="icon-btn" data-close aria-label="关闭"><span data-icon="close"></span></button></div><div class="state" data-install-state="detecting"><div><strong>正在检测安装能力</strong><span>正在确认当前浏览器是否支持直接安装…</span></div><div class="skeleton-line" aria-hidden="true"></div></div><div class="state" data-install-state="supported" hidden><div><strong>可以安装</strong><span>点击后将调用浏览器提供的系统安装流程。</span></div><button class="btn primary" data-install-confirm>安装应用</button></div><div class="state" data-install-state="unsupported" hidden><div><strong>使用浏览器菜单添加</strong><span data-install-instructions></span></div></div><div class="state error" data-install-state="error" hidden><div><strong>安装流程未能打开</strong><span>页面其他功能不受影响，可重试检测或按浏览器菜单步骤操作。</span></div><button class="btn text" data-install-retry>重新检测</button></div><div class="state" data-install-state="installed" hidden><div><strong>已安装</strong><span>“我的账单”已经可以从桌面启动。</span></div></div></section>`
  document.body.append(overlay)
  document.querySelectorAll('[data-install-trigger]').forEach(trigger => { trigger.dataset.open = 'install-sheet' })
}

function setInstallState(state) {
  document.querySelectorAll('[data-install-state]').forEach(block => { block.hidden = block.dataset.installState !== state })
}

function initPwaInstall() {
  const triggers = document.querySelectorAll('[data-install-trigger]')
  if (!triggers.length) return
  let timer = null
  const showCapability = () => {
    clearTimeout(timer)
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return setInstallState('installed')
    if (deferredInstallPrompt) return setInstallState('supported')
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const instructions = document.querySelector('[data-install-instructions]')
    if (instructions) instructions.textContent = ios
      ? '在 Safari 底部点“分享”，再选择“添加到主屏幕”。'
      : '打开浏览器菜单，选择“安装应用”或“添加到主屏幕”；当前网页仍可完整使用。'
    setInstallState('unsupported')
  }
  triggers.forEach(trigger => trigger.addEventListener('click', () => {
    setInstallState('detecting')
    timer = setTimeout(showCapability, 450)
  }))
  document.addEventListener('pwa-install-capability', showCapability)
  document.querySelector('[data-install-confirm]')?.addEventListener('click', async event => {
    if (!deferredInstallPrompt) return showCapability()
    try {
      setButtonLoading(event.currentTarget, true, '正在打开系统安装…')
      await deferredInstallPrompt.prompt()
      const choice = await deferredInstallPrompt.userChoice
      deferredInstallPrompt = null
      if (choice.outcome === 'accepted') setInstallState('installed')
      else showCapability()
    } catch (error) {
      setInstallState('error')
    } finally {
      setButtonLoading(event.currentTarget, false)
    }
  })
  document.querySelector('[data-install-retry]')?.addEventListener('click', () => {
    setInstallState('detecting')
    timer = setTimeout(showCapability, 450)
  })
  window.addEventListener('appinstalled', () => setInstallState('installed'))
}

function initMoneyForms() {
  document.querySelectorAll('[data-money-scope]').forEach(scope => {
    const price = scope.querySelector('[data-price]')
    const quantity = scope.querySelector('[data-quantity]')
    const paid = scope.querySelector('[data-paid]')
    const calculated = scope.querySelector('[data-calculated]')
    const total = scope.querySelector('[data-total]')
    const difference = scope.querySelector('[data-difference]')
    if (!price || !quantity) return
    let paidTouched = false
    const update = () => {
      const amountCents = multiplyDecimalToCents(price.value, quantity.value)
      const amount = formatCents(amountCents)
      if (calculated) calculated.textContent = `¥${amount}`
      if (paid && !paidTouched) paid.value = amount
      const paidCents = decimalToScaledInteger(paid?.value || amount, 2)
      if (total) total.textContent = `−¥${formatCents(paidCents)}`
      if (difference) {
        const deltaCents = paidCents - amountCents
        difference.textContent = deltaCents === 0n ? '与计算金额一致' : `与计算金额相差 ¥${formatCents(deltaCents < 0n ? -deltaCents : deltaCents)}`
        difference.style.color = deltaCents === 0n ? 'var(--muted)' : 'var(--warning)'
      }
    }
    paid?.addEventListener('input', () => { paidTouched = true; update() })
    price.addEventListener('input', update)
    quantity.addEventListener('input', update)
    update()
  })
}

function decimalToScaledInteger(rawValue, scale) {
  const normalized = String(rawValue || '0').trim()
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 0n
  const [integer, fraction = ''] = normalized.split('.')
  const padded = `${fraction}${'0'.repeat(scale)}`.slice(0, scale)
  return BigInt(integer) * (10n ** BigInt(scale)) + BigInt(padded || '0')
}

function multiplyDecimalToCents(priceValue, quantityValue) {
  const priceUnits = decimalToScaledInteger(priceValue, 4)
  const quantityUnits = decimalToScaledInteger(quantityValue, 3)
  const raw = priceUnits * quantityUnits
  const divisor = 100000n
  return (raw + divisor / 2n) / divisor
}

function formatCents(cents) {
  const whole = cents / 100n
  return `${whole}.${String(cents % 100n).padStart(2, '0')}`
}

function validateEntry(scope) {
  let valid = true
  scope.querySelectorAll('[data-required]').forEach(input => {
    const numeric = input.dataset.scale !== undefined
    const decimalPattern = numeric ? new RegExp(`^\\d+(?:\\.\\d{1,${input.dataset.scale}})?$`) : null
    const lengthInvalid = (input.minLength > -1 && input.value.length < input.minLength)
      || (input.maxLength > -1 && input.value.length > input.maxLength)
    const invalid = !input.value.trim()
      || (numeric && !decimalPattern.test(input.value.trim()))
      || lengthInvalid
      || (input.dataset.positive === 'true' && Number(input.value) <= 0)
      || (input.dataset.nonnegative === 'true' && Number(input.value) < 0)
      || (input.dataset.max && Number(input.value) > Number(input.dataset.max))
    input.closest('.field')?.classList.toggle('invalid', invalid)
    if (invalid && valid) input.focus()
    valid = valid && !invalid
  })
  const price = scope.querySelector('[data-price]')
  const quantity = scope.querySelector('[data-quantity]')
  if (price && quantity && multiplyDecimalToCents(price.value, quantity.value) > 99999999999n) {
    price.closest('.field')?.classList.add('invalid')
    quantity.closest('.field')?.classList.add('invalid')
    price.focus()
    valid = false
  }
  return valid
}

function initEntrySubmit() {
  document.querySelectorAll('[data-save-entry]').forEach(button => button.addEventListener('click', () => {
    const shell = button.closest('[data-entry-shell]')
    const scope = shell?.querySelector('[data-entry-panel]:not([hidden])') || button.closest('.sheet, .dialog') || document
    if (!validateEntry(scope)) return
    const submitGroup = button.closest('[data-entry-shell]')?.querySelectorAll('[data-save-entry]') || [button]
    submitGroup.forEach(item => { item.disabled = true })
    const original = button.textContent
    button.textContent = '保存中…'
    setTimeout(() => {
      submitGroup.forEach(item => { item.disabled = false })
      button.textContent = original
      const type = scope.dataset.entryPanel === 'income' || button.dataset.saveEntry === 'edit-income' ? '收入' : '支出'
      const persisted = persistEntryFromScope(scope, button.dataset.saveEntry)
      const message = button.dataset.saveEntry === 'continue'
        ? `已保存${type}，继续记下一笔`
        : button.dataset.saveEntry === 'adjustment' ? '调整已保存，净支出与报表已刷新' : `${type}已保存，明细与报表已刷新`
      showToast(message)
      if (button.dataset.saveEntry === 'continue') {
        const fields = type === '收入' ? ['[data-income-name]', '[data-payer]', '[data-income-amount]'] : ['[data-product]']
        fields.forEach(selector => { const input = scope.querySelector(selector); if (input) input.value = '' })
      }
      if (persisted?.type === 'adjustment' && persisted.lifecycle === 'active') {
        updateLedgerCounts()
      }
      if (document.querySelector('[data-page="details"], body[data-page="details"]')) applyDetailFilters(readDetailFilterState())
      if (button.closest('.overlay')) closeOverlay(button.closest('.overlay'))
    }, 1200)
  }))
}

function selectedFundingId(scope) {
  return scope.querySelector('[data-funding-select]')?.value
    || scope.querySelector('[data-funding-picker] .chip.active')?.dataset.fundingId
    || getDefaultFundingChannel()
}

function selectedFieldValue(scope, name) {
  const field = scope.querySelector(`[data-daily-field="${name}"]`)
  if (!field) return ''
  if (field.matches('select, input, textarea')) return field.value
  return field.querySelector('.chip.active')?.textContent.trim() || ''
}

function persistEntryFromScope(scope, action) {
  const records = readLedgerRecords()
  const nowId = `record-${Date.now()}`
  if (action === 'adjustment') {
    const fields = [...scope.querySelectorAll('.field')]
    const type = fields[0]?.querySelector('select')?.value || '消费退款'
    const adjustmentOverlay = scope.closest('#adjustment-sheet')
    const sourceRow = adjustmentOverlay?.__sourceRow
    const source = records.find(record => record.id === sourceRow?.dataset.recordId && record.type === 'expense' && record.lifecycle === 'active')
    if (!source) return null
    const name = `${source.name}调整`
    const amount = scope.querySelector('[data-scale="2"]')?.value || '0.00'
    const occurredAt = scope.querySelector('input[type="datetime-local"]')?.value || currentLocalDateTime()
    const note = scope.querySelector('[data-adjustment-note]')?.value.trim() || ''
    const linkedRecordId = source.id
    const record = { id: nowId, type: 'adjustment', adjustmentType: type, lifecycle: 'active', state: 'active', name, amount, linkedRecordId, occurredAt, note }
    writeLedgerRecords([...records, record])
    return record
  }
  const type = scope.dataset.entryPanel === 'income' || action === 'edit-income' ? 'income' : 'expense'
  const recordId = scope.dataset.sourceRecordId || nowId
  const existing = records.find(record => record.id === recordId)
  const common = { id: recordId, type, lifecycle: existing?.lifecycle || 'active', fundingChannel: selectedFundingId(scope) }
  const record = type === 'income' ? {
    ...existing, ...common,
    name: scope.querySelector('[data-income-name]')?.value.trim() || '',
    payer: scope.querySelector('[data-payer]')?.value.trim() || '',
    category: scope.querySelector('[data-daily-field="category"], #income-category')?.value || '',
    amount: scope.querySelector('[data-income-amount]')?.value || '0.00',
    occurredAt: scope.querySelector('input[type="datetime-local"]')?.value || currentLocalDateTime(),
    note: scope.querySelector('textarea')?.value.trim() || ''
  } : {
    ...existing, ...common,
    name: scope.querySelector('[data-product]')?.value.trim() || '',
    primaryCategory: scope.querySelector('[data-daily-field="primaryCategory"], #category')?.value || '',
    secondaryCategory: scope.querySelector('[data-daily-field="secondaryCategory"], #subcategory')?.value || '',
    unit: scope.querySelector('[data-daily-field="unit"], #unit')?.value || '',
    price: scope.querySelector('[data-price]')?.value || '0.00',
    quantity: scope.querySelector('[data-quantity]')?.value || '0',
    amount: scope.querySelector('[data-paid]')?.value || '0.00',
    purchaseChannel: selectedFieldValue(scope, 'purchaseChannel'),
    location: selectedFieldValue(scope, 'location'),
    occurredAt: scope.querySelector('input[type="datetime-local"]')?.value || currentLocalDateTime(),
    note: scope.querySelector('textarea')?.value.trim() || ''
  }
  const next = existing ? records.map(item => item.id === recordId ? record : item) : [...records, record]
  writeLedgerRecords(next)
  if (scope.__sourceRow) renderLedgerRow(scope.__sourceRow, record)
  return record
}

function updateLedgerCounts() {
  const records = readLedgerRecords()
  const active = records.filter(record => record.lifecycle === 'active').length
  const trash = records.filter(record => record.lifecycle === 'trash').length
  const activeButton = document.querySelector('[data-bill-tab="active"]')
  const trashButton = document.querySelector('[data-bill-tab="trash"]')
  if (activeButton) activeButton.textContent = `有效 ${active}`
  if (trashButton) trashButton.textContent = `回收站 ${trash}`
}

function setControlValue(scope, selector, value) {
  const control = scope?.querySelector(selector)
  if (!control || value === undefined || value === null) return false
  if (control instanceof HTMLSelectElement && ![...control.options].some(option => option.value === value || option.textContent === value)) return false
  control.value = value
  control.dispatchEvent(new Event('input', { bubbles: true }))
  control.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

function selectChipValue(group, value, dataKey) {
  if (!group) return false
  const candidate = [...group.querySelectorAll('.chip')].find(chip => dataKey ? chip.dataset[dataKey] === value : chip.textContent.trim() === (value || '未指定'))
  if (!candidate) return false
  candidate.click()
  return true
}

function currentLocalDateTime() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function createDailyTemplateFromSourceRow(row) {
  const type = row.dataset.ledgerItem
  const base = {
    id: createDailyTemplateId(type), type, name: String(row.dataset.dailyName || '').trim(),
    fundingChannel: row.dataset.dailyFunding || '',
    sourceRecordId: row.dataset.dailySourceRecordId || `${type}-${normalizeDailyTemplateKey(row.dataset.dailyName)}`,
    updatedAt: Date.now()
  }
  if (type === 'expense') return {
    ...base,
    primaryCategory: row.dataset.dailyPrimaryCategory || '',
    secondaryCategory: row.dataset.dailySecondaryCategory || '',
    unit: row.dataset.dailyUnit || '',
    price: row.dataset.dailyPrice || '',
    quantity: row.dataset.dailyQuantity || '',
    paid: row.dataset.dailyPaid || '',
    purchaseChannel: row.dataset.dailyPurchaseChannel || '',
    location: row.dataset.dailyLocation || ''
  }
  return {
    ...base,
    payer: row.dataset.dailyPayer || '',
    category: row.dataset.dailyCategory || '',
    amount: row.dataset.dailyAmount || ''
  }
}

function upsertDailyTemplate(template) {
  const key = normalizeDailyTemplateKey(template.name)
  const current = readDailyTemplates()
  const existing = current.find(item => item.type === template.type && item.key === key)
  if (existing) template.id = existing.id
  writeDailyTemplates([...current.filter(item => !(item.type === template.type && item.key === key)), template])
  return Boolean(existing)
}

function populateDailySourceEditor(row) {
  const type = row.dataset.ledgerItem
  if (!['expense', 'income'].includes(type)) return
  const scope = document.querySelector(type === 'expense' ? '#edit-expense-sheet .sheet' : '#edit-income-sheet .sheet')
  if (!scope) return
  scope.__sourceRow = row
  scope.dataset.sourceRecordId = row.dataset.recordId || row.dataset.dailySourceRecordId || `${type}-${normalizeDailyTemplateKey(row.dataset.dailyName)}`
  scope.dataset.dailySourceRecordId = scope.dataset.sourceRecordId
  if (type === 'expense') {
    setControlValue(scope, '[data-product]', row.dataset.dailyName)
    for (const field of ['primaryCategory', 'secondaryCategory', 'unit', 'purchaseChannel', 'location']) {
      setControlValue(scope, `[data-daily-field="${field}"]`, row.dataset[`daily${field[0].toUpperCase()}${field.slice(1)}`])
    }
    setControlValue(scope, '[data-price]', row.dataset.dailyPrice)
    setControlValue(scope, '[data-quantity]', row.dataset.dailyQuantity)
    setControlValue(scope, '[data-paid]', row.dataset.dailyPaid)
  } else {
    setControlValue(scope, '[data-income-name]', row.dataset.dailyName)
    setControlValue(scope, '[data-payer]', row.dataset.dailyPayer)
    setControlValue(scope, '[data-daily-field="category"]', row.dataset.dailyCategory)
    setControlValue(scope, '[data-income-amount]', row.dataset.dailyAmount)
  }
  setControlValue(scope, '[data-funding-select]', row.dataset.dailyFunding)
}

function applyDailyTemplate(template) {
  const shell = document.querySelector('[data-entry-shell]')
  if (!shell) return
  shell.querySelector(`[data-entry-type="${template.type}"]`)?.click()
  const scope = shell.querySelector(`[data-entry-panel="${template.type}"]`)
  let fallbackUsed = false
  if (template.type === 'expense') {
    setControlValue(scope, '[data-product]', template.name)
    setControlValue(scope, '#category', template.primaryCategory)
    setControlValue(scope, '#subcategory', template.secondaryCategory)
    setControlValue(scope, '#unit', template.unit)
    setControlValue(scope, '[data-price]', template.price)
    setControlValue(scope, '[data-quantity]', template.quantity)
    setControlValue(scope, '[data-paid]', template.paid)
    fallbackUsed = !selectChipValue(scope.querySelector('[data-funding-picker="expense"]'), template.fundingChannel, 'fundingId')
    selectChipValue(scope.querySelector('[data-daily-field="purchaseChannel"]'), template.purchaseChannel)
    selectChipValue(scope.querySelector('[data-daily-field="location"]'), template.location)
    setControlValue(scope, '#expense-time', currentLocalDateTime())
    setControlValue(scope, '#expense-note', '')
  } else {
    setControlValue(scope, '[data-income-name]', template.name)
    setControlValue(scope, '[data-payer]', template.payer)
    setControlValue(scope, '#income-category', template.category)
    setControlValue(scope, '[data-income-amount]', template.amount)
    fallbackUsed = !selectChipValue(scope.querySelector('[data-funding-picker="income"]'), template.fundingChannel, 'fundingId')
    setControlValue(scope, '#income-time', currentLocalDateTime())
    setControlValue(scope, '#income-note', '')
  }
  if (fallbackUsed) selectChipValue(scope.querySelector('[data-funding-picker]'), getDefaultFundingChannel(), 'fundingId')
  writeDailyTemplates(readDailyTemplates().map(item => item.id === template.id ? { ...item, updatedAt: Date.now() } : item))
  closeOverlay(document.getElementById('daily-entry-sheet'))
  showToast(fallbackUsed ? `已填入“${template.name}”，失效资金渠道已回退，请确认` : `已填入“${template.name}”，请确认后保存`)
}

function renderDailyTemplateList(type) {
  const list = document.querySelector('[data-daily-template-list]')
  if (!list) return
  const empty = document.querySelector('[data-daily-template-empty]')
  document.querySelector('[data-daily-sheet-title]').textContent = type === 'expense' ? '选择日常支出' : '选择日常收入'
  document.querySelectorAll('[data-daily-template-type]').forEach(button => {
    const active = button.dataset.dailyTemplateType === type
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  const simulatedState = new URLSearchParams(location.search).get('daily')
  if (empty && ['loading', 'error'].includes(simulatedState) && empty.dataset.dailyStateResolved !== simulatedState) {
    list.hidden = true
    empty.hidden = false
    const content = document.createElement('div')
    const title = document.createElement('strong')
    const message = document.createElement('span')
    title.textContent = simulatedState === 'loading' ? '正在加载日常项目' : '日常项目加载失败'
    message.textContent = simulatedState === 'loading' ? '当前表单不会被清空。' : '当前表单已保留，请重试。'
    content.append(title, message)
    if (simulatedState === 'error') {
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'btn small'
      retry.dataset.dailyTemplateRetry = ''
      retry.textContent = '重试'
      retry.addEventListener('click', () => {
        empty.dataset.dailyStateResolved = 'error'
        renderDailyTemplateList(type)
      })
      content.append(retry)
    } else {
      setTimeout(() => {
        empty.dataset.dailyStateResolved = 'loading'
        const activeType = document.querySelector('[data-daily-template-type].active')?.dataset.dailyTemplateType || type
        renderDailyTemplateList(activeType)
      }, 650)
    }
    empty.replaceChildren(content)
    return
  }
  const templates = readDailyTemplates().filter(item => item.type === type).sort((a, b) => b.updatedAt - a.updatedAt)
  list.hidden = templates.length === 0
  if (empty) empty.hidden = templates.length > 0
  list.replaceChildren(...templates.map(template => {
    const row = document.createElement('div')
    row.className = 'daily-template-row'
    const main = document.createElement('button')
    main.type = 'button'
    main.className = 'daily-template-main'
    const title = document.createElement('strong')
    title.textContent = template.name
    const summary = document.createElement('span')
    summary.textContent = template.type === 'expense'
      ? `${template.primaryCategory || '未分类'} · ${template.quantity || '1'} ${template.unit || ''} · ¥${template.paid || '0.00'}`
      : `${template.payer || '未填写付款方'} · ${template.category || '未分类'} · ¥${template.amount || '0.00'}`
    main.append(title, summary)
    main.addEventListener('click', () => applyDailyTemplate(template))
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'daily-template-remove'
    remove.textContent = '移除'
    remove.setAttribute('aria-label', `从日常${type === 'expense' ? '支出' : '收入'}中移除：${template.name}`)
    remove.addEventListener('click', () => {
      writeDailyTemplates(readDailyTemplates().filter(item => item.id !== template.id))
      renderDailyTemplateList(type)
      showToast(`已移除“${template.name}”`)
    })
    row.append(main, remove)
    return row
  }))
  if (empty && templates.length === 0) {
    const content = document.createElement('div')
    const title = document.createElement('strong')
    const message = document.createElement('span')
    title.textContent = '还没有日常项目'
    message.textContent = '到明细中打开一笔有效账目，选择“加入日常”。'
    content.append(title, message)
    empty.replaceChildren(content)
  }
}

function initDailyTemplates() {
  document.querySelectorAll('[data-daily-source]').forEach(row => row.addEventListener('click', () => populateDailySourceEditor(row)))
  document.querySelectorAll('[data-daily-template-type]').forEach(button => button.addEventListener('click', () => renderDailyTemplateList(button.dataset.dailyTemplateType)))
  document.querySelector('[data-daily-entry-trigger]')?.addEventListener('click', () => {
    const type = document.querySelector('[data-entry-type].active')?.dataset.entryType || 'expense'
    renderDailyTemplateList(type)
  })
}

function initEntryTypes() {
  const shell = document.querySelector('[data-entry-shell]')
  if (!shell) return
  const preferences = getPreferences()
  const setType = type => {
    const safeType = ['expense', 'income'].includes(type) ? type : 'expense'
    shell.querySelectorAll('[data-entry-panel]').forEach(panel => { panel.hidden = panel.dataset.entryPanel !== safeType })
    shell.querySelectorAll('[data-entry-type]').forEach(button => {
      const active = button.dataset.entryType === safeType
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
    const primary = shell.querySelector('[data-save-entry="save"]')
    const daily = shell.querySelector('[data-daily-entry-trigger]')
    if (primary) primary.textContent = safeType === 'income' ? '保存收入' : '保存支出'
    if (daily) daily.textContent = safeType === 'income' ? '日常收入' : '日常支出'
    updatePreferences({ entryType: safeType })
  }
  shell.querySelectorAll('[data-entry-type]').forEach(button => button.addEventListener('click', () => setType(button.dataset.entryType)))
  const amount = shell.querySelector('[data-income-amount]')
  const payer = shell.querySelector('[data-payer]')
  const updateIncome = () => {
    const cents = decimalToScaledInteger(amount?.value || '0', 2)
    const formatted = Number(cents / 100n).toLocaleString('zh-CN') + `.${String(cents % 100n).padStart(2, '0')}`
    const total = shell.querySelector('[data-income-total]')
    if (total) total.textContent = `+¥${formatted}`
    const payerText = shell.querySelector('[data-income-payer]')
    if (payerText) payerText.textContent = payer?.value.trim() || '待填写'
  }
  amount?.addEventListener('input', updateIncome)
  payer?.addEventListener('input', updateIncome)
  shell.querySelectorAll('[data-funding-picker]').forEach(group => {
    const preferred = [...group.querySelectorAll('.chip:not([data-open])')]
      .find(chip => chip.dataset.fundingId === preferences.fundingChannel)
    group.querySelectorAll('.chip').forEach(chip => {
      const active = chip === preferred
      chip.classList.toggle('active', active)
      chip.setAttribute('aria-pressed', String(active))
    })
  })
  setType(preferences.entryType)
  updateIncome()
}

function showLoginFeedback(message) {
  const feedback = document.querySelector('[data-login-feedback]')
  if (!feedback) return
  feedback.hidden = false
  feedback.querySelector('span').textContent = message
}

function getLoginDestination(username) {
  return username.toLocaleLowerCase('zh-CN') === 'admin' ? 'admin-console.html' : 'expense-entry.html'
}

function validatePasswordSafety(input) {
  const normalized = input.value.toLocaleLowerCase('en-US')
  const error = input.closest('.field')?.querySelector('.field-error')
  if (error && !error.dataset.defaultText) error.dataset.defaultText = error.textContent
  const unsafe = /password|qwerty|123456|abcdef/.test(normalized)
    || new Set(['adminadminadmin12', 'welcome12345678']).has(normalized)
  input.closest('.field')?.classList.toggle('invalid', unsafe)
  if (unsafe) {
    error?.replaceChildren('该密码属于常见或已泄露模式，请更换')
    input.focus()
  } else if (error?.dataset.defaultText) {
    error.textContent = error.dataset.defaultText
  }
  return !unsafe
}

function validateNewPassword(scope, passwordSelector, confirmationSelector) {
  const password = scope.querySelector(passwordSelector)
  const error = password?.closest('.field')?.querySelector('.field-error')
  if (error?.dataset.defaultText) error.textContent = error.dataset.defaultText
  if (!validateEntry(scope)) return false
  const confirmation = scope.querySelector(confirmationSelector)
  if (!validatePasswordSafety(password)) return false
  const mismatch = password.value !== confirmation.value
  confirmation.closest('.field')?.classList.toggle('invalid', mismatch)
  if (mismatch) confirmation.focus()
  return !mismatch
}

function initLogin() {
  const form = document.getElementById('login-form')
  if (!form) return
  if (new URLSearchParams(location.search).get('reason') === 'account-cancelled') {
    const sessionFeedback = document.querySelector('[data-session-feedback]')
    sessionFeedback.hidden = false
    sessionFeedback.querySelector('span').textContent = '账号已进入注销处理，原会话已失效。'
  }
  form.addEventListener('submit', event => {
    event.preventDefault()
    const feedback = document.querySelector('[data-login-feedback]')
    if (feedback) feedback.hidden = true
    const sessionFeedback = document.querySelector('[data-session-feedback]')
    if (sessionFeedback) sessionFeedback.hidden = true
    if (!validateEntry(form)) return
    const username = form.querySelector('#account').value.trim()
    const password = form.querySelector('#password').value
    const button = form.querySelector('button[type="submit"]')
    setButtonLoading(button, true, '登录中…')
    setTimeout(() => {
      setButtonLoading(button, false)
      if (username === 'network_error') return showLoginFeedback('网络连接失败，输入内容已保留，请重试。')
      if (username === 'system_error') return showLoginFeedback('系统暂时不可用，输入内容已保留，请稍后重试。')
      if (username === 'stopped_user') return showLoginFeedback('账号已停用，请联系系统管理员。')
      if (!['LedgerSafe!2026A', 'TempPassword123'].includes(password)) return showLoginFeedback('用户名或密码错误，请核对后重试。')
      if (password === 'TempPassword123') {
        const destination = getLoginDestination(username)
        form.dataset.loginDestination = destination
        const firstPasswordButton = document.querySelector('[data-first-password-save]')
        firstPasswordButton.textContent = destination === 'admin-console.html' ? '设置并进入系统管理' : '设置并进入记一笔'
        return openOverlay('first-password-sheet')
      }
      location.href = getLoginDestination(username)
    }, 650)
  })
  document.querySelector('[data-first-password-save]')?.addEventListener('click', event => {
    const sheet = event.currentTarget.closest('.sheet')
    if (!validateNewPassword(sheet, '[data-new-password]', '[data-new-password-confirm]')) return
    setButtonLoading(event.currentTarget, true, '设置中…')
    setTimeout(() => {
      setButtonLoading(event.currentTarget, false)
      location.href = form.dataset.loginDestination || 'expense-entry.html'
    }, 650)
  })
}

const reportViews = {
  overview: ['收支趋势', '人民币 · 按业务时间', ['收入|9600.00|94', '净支出|1076.80|42', '结余|8523.20|82']],
  trend: ['每日实付趋势', '人民币 · 按消费时间', ['6日|63.00|35', '7日|118.50|62', '8日|81.30|44', '9日|236.00|94', '10日|106.80|57']],
  category: ['分类消费占比', '人民币 · 一级分类', ['餐饮|528.00|88', '日用|246.80|55', '交通|188.00|42', '其他|114.00|30']],
  product: ['商品消费排行', '人民币 · 按商品', ['早餐包|168.00|80', '苹果|93.60|52', '矿泉水|28.50|28']],
  payment: ['支付方式结构', '人民币 · 按支付方式', ['微信|612.80|92', '支付宝|304.00|62', '银行卡|160.00|38']],
  channel: ['购买渠道结构', '人民币 · 含未指定', ['商超|486.00|82', '便利店|248.00|55', '未指定|190.80|43']],
  location: ['购买位置结构', '人民币 · 含未指定', ['家附近超市|388.00|78', '公司楼下|206.00|48', '未指定|482.80|88']],
  habit: ['星期消费习惯', '人民币 · 按星期', ['周一|106.00|35', '周三|248.00|62', '周六|336.00|86']],
  price: ['价格变化线索', '人民币 · 填写单价', ['早餐包|14.00|62', '苹果/千克|11.80|48', '矿泉水|3.50|28']],
  frequency: ['复购频次', '消费明细数 · 按商品', ['矿泉水|8|88', '早餐包|6|70', '苹果|4|50']],
  quality: ['数据质量线索', '线索数 · 仅提示', ['疑似重复|2|62', '异常高价|1|38', '未分类|1|38']],
  incomeTrend: ['每日收入趋势', '人民币 · 按收入时间', ['1日|8500.00|94', '5日|300.00|36', '10日|1100.00|55']],
  incomeCategory: ['收入分类结构', '人民币 · 按收入分类', ['工资|8500.00|94', '兼职|1100.00|55', '其他|300.00|32']],
  payer: ['付款方结构', '人民币 · 按付款方', ['示例科技有限公司|8500.00|94', '客户李先生|1100.00|55']],
  incomeName: ['收入名称结构', '人民币 · 名称不唯一', ['8 月工资|8500.00|94', '项目兼职|1100.00|55']],
  receiving: ['收款方式结构', '人民币 · 按资金渠道', ['银行卡|8500.00|94', '微信|1100.00|55']],
  incomeFrequency: ['收入频次', '收入明细数 · 按名称', ['项目兼职|2|70', '月度工资|1|42']]
}

const reportScopes = {
  overview: [{ key: 'overview', label: '收支趋势' }],
  expense: [{ key: 'trend', label: '趋势' }, { key: 'category', label: '分类' }, { key: 'product', label: '商品' }, { key: 'payment', label: '支付方式' }, { key: 'channel', label: '渠道' }, { key: 'location', label: '位置' }, { key: 'habit', label: '习惯' }, { key: 'price', label: '价格' }, { key: 'frequency', label: '频次' }, { key: 'quality', label: '数据质量' }],
  income: [{ key: 'incomeTrend', label: '趋势' }, { key: 'incomeCategory', label: '收入分类' }, { key: 'payer', label: '付款方' }, { key: 'incomeName', label: '收入名称' }, { key: 'receiving', label: '收款方式' }, { key: 'incomeFrequency', label: '频次' }]
}

const reportScopeLabels = { overview: '全部账目', expense: '支出', income: '收入' }
const reportAuxDimensionLabels = { type: '账目类型', adjustment: '退款/报销调整', balance: '结余', all: '全部明细' }

function getReportDimensionLabel(scope, dimension) {
  return reportScopes[scope]?.find(item => item.key === dimension)?.label || reportAuxDimensionLabels[dimension] || '筛选'
}

function getReportFilterLabel(key, value) {
  const control = document.querySelector(`[data-filter-key="${key}"]`)
  if (control?.tagName === 'SELECT') return [...control.options].find(option => option.value === value)?.textContent || value
  return value
}

function reportSummary(records) {
  const income = records.filter(record => record.type === 'income').reduce((sum, record) => sum + Number(record.amount), 0)
  const expense = records.filter(record => record.type === 'expense').reduce((sum, record) => sum + Number(record.amount), 0)
  const adjustments = records.filter(record => record.type === 'adjustment' && record.state === 'active').reduce((sum, record) => sum + Number(record.amount), 0)
  return { income, expense, adjustments, netExpense: Math.max(0, expense - adjustments), balance: income - Math.max(0, expense - adjustments) }
}

function reportSeries(scope, dimension, records) {
  if (scope === 'overview') {
    const summary = reportSummary(records)
    return [['收入', summary.income], ['净支出', summary.netExpense], ['结余', summary.balance]]
  }
  const normal = records.filter(record => record.type === scope)
  const adjustments = records.filter(record => record.type === 'adjustment' && record.state === 'active')
  const keyFor = record => {
    if (['trend', 'incomeTrend'].includes(dimension)) return `${Number(record.occurredAt?.slice(8, 10) || 0)}日`
    if (dimension === 'category') return record.primaryCategory || '未分类'
    if (['product', 'incomeName', 'frequency', 'incomeFrequency'].includes(dimension)) return record.name
    if (['payment', 'receiving'].includes(dimension)) return getFundingChannelName(record.fundingChannel)
    if (dimension === 'channel') return record.purchaseChannel || '未指定'
    if (dimension === 'location') return record.location || '未指定'
    if (dimension === 'price') return `${record.name}/${record.unit || '次'}`
    if (dimension === 'incomeCategory') return record.category || '未分类'
    if (dimension === 'payer') return record.payer || '未填写'
    if (dimension === 'habit') return new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(record.occurredAt))
    return record.name || '其他'
  }
  const groups = new Map()
  normal.forEach(record => {
    let value = ['frequency', 'incomeFrequency'].includes(dimension) ? 1 : dimension === 'price' ? Number(record.price || record.amount) : Number(record.amount)
    if (scope === 'expense' && !['frequency', 'price'].includes(dimension)) {
      value -= adjustments.filter(item => item.linkedRecordId === record.id).reduce((sum, item) => sum + Number(item.amount), 0)
    }
    const key = keyFor(record)
    groups.set(key, (groups.get(key) || 0) + value)
  })
  return [...groups.entries()].sort((a, b) => b[1] - a[1])
}

function resolveReportData(filterState, scope, dimension) {
  const filters = { ...filterState.values, range: filterState.range, scope: scope === 'overview' ? 'all' : scope }
  const records = filterLedgerRecords(readLedgerRecords(), filters, { reportOnly: true })
  return { records, series: reportSeries(scope, dimension, records), summary: reportSummary(records) }
}

function updateReportSummary(summary) {
  const values = [summary.income, summary.expense, summary.adjustments, summary.balance]
  document.querySelectorAll('[data-balance-summary] > button strong').forEach((strong, index) => {
    strong.textContent = `${index === 1 ? '−' : '+'}¥${formatMoney(values[index])}`
  })
  const formula = document.querySelector('.balance-formula')
  if (formula) formula.textContent = `净支出 ¥${formatMoney(summary.netExpense)} = 原始支出 − 冲减；结余 = 收入 − 净支出`
}

function ensureReportEmptyState() {
  const region = document.querySelector('[data-state-region="report"]')
  if (!region || document.querySelector('[data-report-filter-empty]')) return
  const state = document.createElement('section')
  state.className = 'state'
  state.dataset.reportFilterEmpty = ''
  state.hidden = true
  state.innerHTML = '<div><strong>当前条件没有可统计账目</strong><span>调整账目范围、关键词、分类、资金渠道或时间范围后重试。</span></div><button class="btn text" type="button" data-clear-report-filter>清除筛选</button>'
  region.before(state)
  state.querySelector('[data-clear-report-filter]').addEventListener('click', () => document.querySelector('#filter-sheet [data-clear-filters]')?.click())
}

function renderReportRangeCopy(rangeValue, scope) {
  const label = rangeDisplayLabel(rangeValue)
  const dateCaptions = {
    今天: '今天 · 2026年8月13日', 本周: '本周 · 8月10日至16日', 本月: '本月 · 2026年8月',
    上月: '上月 · 2026年7月', 今年: '今年 · 2026年'
  }
  const dateCaption = document.querySelector('[data-report-date-caption]')
  if (dateCaption) dateCaption.textContent = dateCaptions[rangeValue] || `指定日期 · ${label}`
  const balanceLabel = document.querySelector('[data-report-balance-label]')
  if (balanceLabel) balanceLabel.textContent = `${label}结余`
  const balanceDrill = document.querySelector('[data-report-balance-drill]')
  if (balanceDrill) balanceDrill.dataset.value = `${label}结余`
  const rankingTitle = document.querySelector('[data-ranking-title]')
  if (rankingTitle) rankingTitle.textContent = scope === 'income' ? `${label}收入排行` : scope === 'expense' ? `${label}支出排行` : `${label}收支构成`
}

function deriveReportFilterState(reportFilter, scope) {
  const requestedFilterScope = scope === 'overview' ? 'all' : scope
  if (reportFilter.scope === requestedFilterScope) return reportFilter
  const values = {
    range: reportFilter.values.range,
    scope: requestedFilterScope,
    funding: reportFilter.values.funding,
    keyword: reportFilter.values.keyword || ''
  }
  const summary = [
    rangeDisplayLabel(values.range),
    reportScopeLabels[scope],
    getReportFilterLabel('funding', values.funding),
    values.keyword && `搜索“${values.keyword}”`
  ].filter(Boolean).join(' · ')
  return { scope: requestedFilterScope, range: values.range, summary, values }
}

function readReportFilterState() {
  const sheet = document.getElementById('filter-sheet')
  if (!sheet) return { scope: 'all', range: '本月', summary: '本月 · 全部账目', values: {} }
  const controls = getActiveFormControls(sheet).filter(control => control.dataset.filterKey)
  const values = Object.fromEntries(controls.map(control => [control.dataset.filterKey, control.value]))
  values.range = readRangeControl(sheet.querySelector('[data-report-range]'), sheet.querySelector('[data-report-range-start]'), sheet.querySelector('[data-report-range-end]')) || getPreferences().reportRange
  values.keyword = document.querySelector('[data-report-global-search]')?.value.trim() || ''
  const labels = [rangeDisplayLabel(values.range), getReportFilterLabel('scope', values.scope), getReportFilterLabel('funding', values.funding), values.expenseCategory, values.incomeCategory, values.keyword && `搜索“${values.keyword}”`]
    .filter(value => value && !String(value).startsWith('全部支出分类') && !String(value).startsWith('全部收入分类'))
  return { scope: values.scope || 'all', range: values.range, summary: labels.join(' · '), values }
}

function restoreReportFilterState(values = {}) {
  document.querySelectorAll('#filter-sheet [data-filter-key]').forEach(control => {
    control.value = control.tagName === 'SELECT' ? control.options[0].value : ''
  })
  Object.entries(values).filter(([key]) => !['range', 'keyword'].includes(key)).forEach(([key, value]) => {
    const control = document.querySelector(`[data-filter-key="${key}"]`)
    if (control) control.value = value
  })
  restoreRangeControl(document.querySelector('[data-report-range]'), document.querySelector('[data-report-range-start]'), document.querySelector('[data-report-range-end]'), values.range || getPreferences().reportRange)
  const search = document.querySelector('[data-report-global-search]')
  if (search) search.value = values.keyword || ''
  document.querySelector('[data-report-filter-scope]')?.dispatchEvent(new Event('change'))
}

function initReports() {
  const host = document.querySelector('[data-report-view]')
  if (!host) return
  if (document.querySelector('[data-state-region="report"] > .region-state')) return
  ensureReportEmptyState()
  let scope = 'overview'
  const render = key => {
    const view = reportViews[key]
    if (!view) return
    const data = resolveReportData(host.__reportState || readReportFilterState(), scope, key)
    const empty = document.querySelector('[data-report-filter-empty]')
    const region = document.querySelector('[data-state-region="report"]')
    const hasData = data.series.length > 0
    if (empty) empty.hidden = hasData
    if (region) region.hidden = !hasData
    updateReportSummary(data.summary)
    if (!hasData) return
    host.classList.toggle('report-expense', scope === 'expense')
    host.classList.toggle('report-income', scope === 'income')
    host.querySelector('[data-report-title]').textContent = view[0]
    host.querySelector('[data-report-caption]').textContent = view[1]
    const chart = host.querySelector('[data-report-chart]')
    const max = Math.max(...data.series.map(item => Math.abs(item[1])), 1)
    chart.innerHTML = data.series.map(([label, numericValue], index) => {
      const value = Number(numericValue).toFixed(['frequency', 'incomeFrequency'].includes(key) ? 0 : 2)
      const height = Math.max(18, Math.round(Math.abs(numericValue) / max * 94))
      const safeLabel = escapeHtml(label)
      const drillDimension = scope === 'overview' ? (label === '结余' ? 'balance' : 'type') : key
      const drillValue = scope === 'overview' ? (label === '收入' ? '总收入' : label === '净支出' ? '原始支出' : `${rangeDisplayLabel((host.__reportState || readReportFilterState()).range)}结余`) : safeLabel
      const seriesClass = scope === 'overview' && label.includes('支出') ? ' expense-series' : scope === 'overview' && label.includes('收入') ? ' income-series' : ''
      return `<button type="button" class="bar${index === 0 ? ' active' : ''}${seriesClass}" style="--h:${height}%" data-dimension="${drillDimension}" data-label="${safeLabel}" data-value="${escapeHtml(drillValue)}" data-metric="${value}" data-scope="${scope}" aria-label="${safeLabel}，${value}"><span>${safeLabel}</span></button>`
    }).join('')
    initReportDrill(chart)
    const ranking = document.querySelector('[data-report-ranking]')
    if (ranking) ranking.innerHTML = data.series.slice(0, 3).map(([label, numericValue], index) => {
      const value = Number(numericValue).toFixed(['frequency', 'incomeFrequency'].includes(key) ? 0 : 2)
      const safeLabel = escapeHtml(label)
      const drillDimension = scope === 'overview' ? (label === '结余' ? 'balance' : 'type') : key
      const drillValue = scope === 'overview' ? (label === '收入' ? '总收入' : label === '净支出' ? '原始支出' : `${rangeDisplayLabel((host.__reportState || readReportFilterState()).range)}结余`) : safeLabel
      const sign = scope === 'expense' ? '−' : scope === 'income' ? '+' : ''
      return `<button class="rank-row" data-drill data-scope="${scope}" data-dimension="${drillDimension}" data-value="${escapeHtml(drillValue)}" data-metric="${value}"><span class="rank-index">0${index + 1}</span><span>${safeLabel}</span><strong class="rank-value ${scope === 'expense' ? 'expense-amount' : scope === 'income' ? 'income-amount' : ''}">${sign}${isNaN(Number(value)) ? value : `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`}</strong></button>`
    }).join('')
    initReportDrill(ranking || document)
  }
  const renderScope = (nextScope, selectedDimension) => {
    scope = reportScopes[nextScope] ? nextScope : 'overview'
    const filterScope = scope === 'overview' ? 'all' : scope
    const filterSelect = document.querySelector('[data-report-filter-scope]')
    if (filterSelect && filterSelect.value !== filterScope) {
      filterSelect.value = filterScope
      filterSelect.dispatchEvent(new Event('change'))
    }
    const filterSummary = document.querySelector('[data-filter-summary-text]')
    const appliedFilter = readReportFilterState()
    host.__reportState = appliedFilter
    if (filterSummary) filterSummary.textContent = appliedFilter.summary
    renderReportRangeCopy(appliedFilter.range, scope)
    const balanceSummary = document.querySelector('[data-balance-summary]')
    if (balanceSummary) balanceSummary.hidden = scope !== 'overview'
    const reportAll = document.querySelector('[data-report-all]')
    if (reportAll) {
      reportAll.dataset.drillScope = scope
      reportAll.dataset.value = scope === 'overview' ? '全部收支明细' : scope === 'expense' ? '全部支出明细' : '全部收入明细'
    }
    sessionStorage.setItem('bill-report-scope', scope)
    document.querySelectorAll('[data-report-scope]').forEach(button => {
      const active = button.dataset.reportScope === scope
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
    const dimensions = document.querySelector('[data-report-dimension-select]')
    const validDimension = reportScopes[scope].some(item => item.key === selectedDimension) ? selectedDimension : reportScopes[scope][0].key
    dimensions.replaceChildren(...reportScopes[scope].map(item => {
      const option = document.createElement('option')
      option.value = item.key
      option.textContent = item.label
      return option
    }))
    dimensions.value = validDimension
    dimensions.onchange = () => render(dimensions.value)
    render(validDimension)
  }
  host.__renderScope = renderScope
  document.querySelectorAll('[data-report-scope]').forEach(button => button.addEventListener('click', () => {
    const nextFilterScope = button.dataset.reportScope === 'overview' ? 'all' : button.dataset.reportScope
    const values = { ...(host.__reportState?.values || {}), scope: nextFilterScope }
    restoreReportFilterState(values)
    renderScope(button.dataset.reportScope)
  }))
  document.querySelector('[data-open="filter-sheet"]')?.addEventListener('click', () => {
    restoreReportFilterState(host.__reportState?.values || {})
  })
  const params = new URLSearchParams(location.search)
  let restored = null
  try { restored = JSON.parse(params.get('restore') || 'null') } catch (error) { restored = null }
  if (restored?.filterValues) {
    restoreReportFilterState(restored.filterValues)
  } else {
    const preferredRange = reportRangeValues[getPreferences().reportRange]
    const rangeSelect = document.querySelector('[data-report-range]')
    if (rangeSelect) restoreRangeControl(rangeSelect, document.querySelector('[data-report-range-start]'), document.querySelector('[data-report-range-end]'), preferredRange)
  }
  const initialScope = reportScopes[restored?.scope] ? restored.scope : sessionStorage.getItem('bill-report-scope') || 'overview'
  renderScope(initialScope, restored?.dimension)
  if (restored) {
    requestAnimationFrame(() => window.scrollTo(0, Number(restored.scrollY) || 0))
  }
  let searchTimer
  document.querySelector('[data-report-global-search]')?.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => renderScope(scope, document.querySelector('[data-report-dimension-select]')?.value), 180)
  })
}

function initReportDrill(root = document) {
  root.querySelectorAll('[data-drill], .bar[data-dimension]').forEach(item => {
    if (item.dataset.drillBound === 'true') return
    item.dataset.drillBound = 'true'
    item.addEventListener('click', () => {
    const dimension = item.dataset.dimension || 'product'
    const value = item.dataset.value || item.dataset.label || ''
    const appliedFilter = document.querySelector('[data-report-view]')?.__reportState || readReportFilterState()
    const appliedScope = appliedFilter.scope === 'all' ? 'overview' : appliedFilter.scope
    const scope = reportScopes[item.dataset.drillScope] ? item.dataset.drillScope : appliedScope
    const reportFilter = deriveReportFilterState(appliedFilter, scope)
    const filters = reportFilter.summary
    const context = { scope, dimension, value, range: reportFilter.range, filters, filterValues: reportFilter.values, scrollY: window.scrollY }
    sessionStorage.setItem('bill-report-return', JSON.stringify(context))
    location.href = `bill-details.html?source=reports&scope=${encodeURIComponent(scope)}&dimension=${encodeURIComponent(dimension)}&value=${encodeURIComponent(value)}&range=${encodeURIComponent(context.range)}&filters=${encodeURIComponent(filters)}`
    })
  })
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function renderLedgerRow(row, record) {
  if (!row || !record) return
  row.dataset.recordId = record.id
  row.dataset.ledgerItem = record.type
  row.dataset.dailyName = record.name || ''
  row.dataset.dailyFunding = record.fundingChannel || ''
  const title = row.querySelector('.item-title')
  const meta = row.querySelector('.item-meta')
  const amount = row.querySelector('.item-amount')
  const tag = title?.querySelector('[data-type-tag]')
  if (record.type === 'expense') {
    Object.assign(row.dataset, {
      dailyPrimaryCategory: record.primaryCategory || '', dailySecondaryCategory: record.secondaryCategory || '',
      dailyUnit: record.unit || '', dailyPrice: record.price || '', dailyQuantity: record.quantity || '',
      dailyPaid: record.amount || '', dailyPurchaseChannel: record.purchaseChannel || '', dailyLocation: record.location || ''
    })
    if (tag) { tag.textContent = '支出'; tag.className = 'tag expense' }
    if (title) title.lastChild.textContent = ` ${record.name}`
    if (meta) meta.innerHTML = `${escapeHtml(record.occurredAt?.slice(5).replace('T', ' ') || '')} · ${escapeHtml(record.quantity)} ${escapeHtml(record.unit)} × ¥${escapeHtml(record.price)} · ${escapeHtml(getFundingChannelName(record.fundingChannel))}<br>${escapeHtml(record.purchaseChannel || '未指定')} · ${escapeHtml(record.location || '未指定')}`
    if (amount) { amount.textContent = `−¥${formatMoney(record.amount)}`; amount.className = 'item-amount expense-amount' }
    const net = row.querySelector('.item-amount + .tag')
    if (net) {
      const adjustments = readLedgerRecords().filter(item => item.linkedRecordId === record.id && item.lifecycle === 'active' && item.state === 'active').reduce((sum, item) => sum + Number(item.amount), 0)
      net.textContent = `净支出 ¥${formatMoney(Math.max(0, Number(record.amount) - adjustments))}`
    }
  } else if (record.type === 'income') {
    Object.assign(row.dataset, { dailyPayer: record.payer || '', dailyCategory: record.category || '', dailyAmount: record.amount || '' })
    if (tag) { tag.textContent = '收入'; tag.className = 'tag income' }
    if (title) title.lastChild.textContent = ` ${record.name}`
    if (meta) meta.textContent = `${record.occurredAt?.slice(5).replace('T', ' ') || ''} · ${record.payer} · ${record.category} · ${getFundingChannelName(record.fundingChannel)}`
    if (amount) { amount.textContent = `+¥${formatMoney(record.amount)}`; amount.className = 'item-amount income-amount' }
  } else {
    row.dataset.adjustmentId = record.id
    row.dataset.adjustmentState = record.state || 'active'
    if (record.linkedRecordId) row.dataset.originalId = record.linkedRecordId
    if (tag) {
      tag.textContent = record.state === 'frozen' ? '已冻结' : record.state === 'revoked' ? '已撤销' : record.adjustmentType === '费用报销' ? '报销' : '退款'
      tag.className = ['frozen', 'revoked'].includes(record.state) ? 'tag warning' : 'tag adjustment'
    }
    if (title) title.lastChild.textContent = ` ${record.name}`
    if (meta) meta.textContent = record.state === 'frozen' ? '随原支出冻结 · 不参与报表' : record.state === 'revoked' ? '已撤销 · 不参与报表' : `${record.occurredAt?.slice(5).replace('T', ' ') || ''} · ${record.note || '已关联原支出'}`
    if (amount) amount.textContent = `${record.state === 'active' ? '+' : ''}¥${formatMoney(record.amount)}`
  }
}

function bindAdjustmentRow(row) {
  bindOverlayTrigger(row)
  if (row.dataset.adjustmentBound === 'true') return
  row.dataset.adjustmentBound = 'true'
  row.addEventListener('click', () => {
    const detail = document.getElementById('adjustment-detail')
    if (!detail) return
    detail.__adjustmentRow = row
    const record = readLedgerRecords().find(item => item.id === row.dataset.recordId)
    const name = row.querySelector('.item-title')?.textContent.trim() || '当前调整'
    detail.querySelector('[data-adjustment-detail-name]').textContent = name
    const note = detail.querySelector('[data-adjustment-detail-note]')
    if (note) note.textContent = record?.note || '无备注'
  })
}

function createAdjustmentRow({ id, name, amount, state = 'active', adjustmentType = '消费退款', note = '' }) {
  const row = document.createElement('button')
  row.className = 'list-item'
  row.dataset.ledgerItem = 'adjustment'
  row.dataset.adjustmentId = id
  row.dataset.recordId = id
  row.dataset.adjustmentState = state
  row.dataset.open = 'adjustment-detail'
  const description = document.createElement('div')
  const title = document.createElement('div')
  title.className = 'item-title'
  const tag = document.createElement('span')
  tag.className = 'tag adjustment'
  tag.dataset.typeTag = ''
  tag.textContent = adjustmentType === '费用报销' ? '报销' : '退款'
  title.append(tag, ` ${name}`)
  const meta = document.createElement('div')
  meta.className = 'item-meta'
  meta.textContent = note || '已关联原支出'
  const amountElement = document.createElement('div')
  amountElement.className = 'item-amount'
  amountElement.textContent = `¥${amount}`
  description.append(title, meta)
  row.append(description, amountElement)
  row.dataset.adjustmentType = adjustmentType
  row.dataset.adjustmentNote = note
  bindAdjustmentRow(row)
  bindLedgerItemGestures(row)
  return row
}

function mountDetailLifecycleControls() {
  const sheet = document.querySelector('#adjustment-sheet .sheet')
  if (sheet && !sheet.querySelector('[data-adjustment-note]')) {
    const action = sheet.querySelector('[data-save-entry="adjustment"]')
    const field = document.createElement('div')
    field.className = 'field'
    field.innerHTML = '<label>备注（选填）</label><textarea class="control" data-adjustment-note placeholder="退款原因、报销说明等"></textarea>'
    action.before(field)
  }
  const detail = document.querySelector('#adjustment-detail .sheet')
  if (detail && !detail.querySelector('[data-adjustment-detail-note]')) {
    const info = document.createElement('div')
    info.className = 'setting-row static'
    info.innerHTML = '<span>备注</span><span class="setting-value" data-adjustment-detail-note>无备注</span>'
    detail.querySelector('.state')?.insertAdjacentElement('afterend', info)
  }
  initFormAccessibility()
}

function prepareLinkedAdjustment(row) {
  const records = readLedgerRecords()
  const source = records.find(record => record.id === row?.dataset.recordId && record.type === 'expense' && record.lifecycle === 'active')
  if (!source) return showToast('只能从有效支出发起退款或报销')
  const adjusted = records.filter(record => record.linkedRecordId === source.id && record.lifecycle === 'active' && record.state === 'active').reduce((sum, record) => sum + Number(record.amount), 0)
  const remaining = Math.max(0, Number(source.amount) - adjusted)
  if (!remaining) return showToast('该支出已无可调整金额')
  const overlay = document.getElementById('adjustment-sheet')
  overlay.__sourceRow = row
  const caption = overlay.querySelector('.caption')
  const amount = overlay.querySelector('[data-scale="2"]')
  const error = amount?.closest('.field')?.querySelector('.field-error')
  if (caption) caption.textContent = `关联：${source.name} · 原实付 ¥${formatMoney(source.amount)} · 已调整 ¥${formatMoney(adjusted)}`
  if (amount) { amount.max = String(remaining); amount.dataset.max = String(remaining); amount.value = remaining.toFixed(2) }
  if (error) error.textContent = `本次最多 ¥${formatMoney(remaining)}，累计不得超过原实付`
  openOverlay('adjustment-sheet')
}

function readDetailFilterState() {
  const sheet = document.getElementById('detail-filter')
  const values = Object.fromEntries([...sheet?.querySelectorAll('[data-detail-filter-key]') || []].map(control => [control.dataset.detailFilterKey, control.value]))
  const lifecycle = document.querySelector('[data-bill-tab].active')?.dataset.billTab || 'active'
  const range = readRangeControl(sheet?.querySelector('[data-detail-range]'), sheet?.querySelector('[data-detail-range-start]'), sheet?.querySelector('[data-detail-range-end]')) || getPreferences().detailRange
  const keyword = document.querySelector('[data-detail-global-search]')?.value.trim() || ''
  let applied = {}
  try { applied = JSON.parse(document.querySelector('[data-page-content]')?.getAttribute('data-applied-detail-filter') || '{}') } catch (error) { applied = {} }
  return { range, type: values.type || 'all', keyword, funding: values.funding || fundingFilterAllValue, lifecycle, drillDimension: applied.drillDimension || '', drillValue: applied.drillValue || '' }
}

function detailFilterSummary(filters) {
  const labels = {
    type: { all: '全部账目', expense: '支出', income: '收入', adjustment: '退款/报销' }[filters.type],
    funding: filters.funding === fundingFilterAllValue ? '全部渠道' : getFundingChannelName(filters.funding)
  }
  return [rangeDisplayLabel(filters.range), labels.type, labels.funding].filter(Boolean).join(' · ')
}

let detailVisibleLimit = 20
let detailFilterSignature = ''

function ledgerDayLabel(date) {
  if (date === '2026-08-13') return '今天'
  if (date === '2026-08-12') return '昨天'
  const parsed = new Date(`${date}T12:00:00`)
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 · ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parsed.getDay()]}`
}

function renderActiveLedgerRecords(records, filters) {
  const list = document.querySelector('[data-ledger-list]')
  if (!list) return
  const signature = JSON.stringify({ range: filters.range, type: filters.type, keyword: filters.keyword, funding: filters.funding, drillDimension: filters.drillDimension, drillValue: filters.drillValue })
  if (signature !== detailFilterSignature) { detailVisibleLimit = 20; detailFilterSignature = signature }
  const sorted = [...records].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
  const visible = sorted.slice(0, detailVisibleLimit)
  const groups = new Map()
  visible.forEach(record => {
    const date = String(record.occurredAt || '').slice(0, 10) || '未知日期'
    if (!groups.has(date)) groups.set(date, [])
    groups.get(date).push(record)
  })
  list.replaceChildren(...[...groups].map(([date, items]) => {
    const section = document.createElement('section')
    section.className = 'ledger-day-group'
    const header = document.createElement('div')
    header.className = 'ledger-day-head'
    header.innerHTML = `<strong>${escapeHtml(ledgerDayLabel(date))}</strong><span>${items.length} 笔</span>`
    const rows = document.createElement('div')
    rows.className = 'list ledger-day-list'
    rows.append(...items.map(createLedgerRow))
    section.append(header, rows)
    return section
  }))
  const wrap = document.querySelector('[data-ledger-load-more-wrap]')
  if (wrap) wrap.hidden = visible.length >= sorted.length
  const status = document.querySelector('[data-ledger-load-status]')
  if (status) status.textContent = sorted.length ? `已显示 ${visible.length} / ${sorted.length} 笔` : ''
}

function applyDetailFilters(filters = readDetailFilterState()) {
  const records = readLedgerRecords()
  const activeRecords = filterLedgerRecords(records, filters)
  const trashIds = new Set(filterLedgerRecords(records, filters, { lifecycle: 'trash' }).map(record => record.id))
  renderActiveLedgerRecords(activeRecords, filters)
  document.querySelectorAll('[data-view="trash"] [data-record-id]').forEach(row => { row.hidden = !trashIds.has(row.dataset.recordId) })
  const activeView = !document.querySelector('[data-view="active"]')?.hidden
  const visible = activeView ? activeRecords.length : trashIds.size
  const empty = document.querySelector('[data-ledger-empty]')
  if (empty) empty.hidden = visible > 0
  document.querySelectorAll('[data-ledger-type]').forEach(button => {
    const selected = button.dataset.ledgerType === filters.type
    button.classList.toggle('active', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
  document.querySelectorAll('[data-ledger-list], [data-trash-list]').forEach(list => { list.dataset.typeScope = filters.type })
  const summary = document.querySelector('[data-detail-filter-summary]')
  if (summary) summary.textContent = detailFilterSummary(filters)
  sessionStorage.setItem(detailFilterStorageKey, JSON.stringify(filters))
  document.querySelector('[data-page-content]')?.setAttribute('data-applied-detail-filter', JSON.stringify(filters))
  return visible
}

function createLedgerRow(record) {
  if (record.type === 'adjustment') {
    const row = createAdjustmentRow(record)
    if (record.linkedRecordId) row.dataset.originalId = record.linkedRecordId
    renderLedgerRow(row, record)
    return row
  }
  const row = document.createElement('button')
  row.type = 'button'
  row.className = 'list-item'
  row.dataset.recordId = record.id
  row.dataset.ledgerItem = record.type
  row.dataset.dailySource = ''
  row.dataset.open = record.type === 'income' ? 'edit-income-sheet' : 'edit-expense-sheet'
  row.innerHTML = `<div><div class="item-title"><span class="tag ${record.type}" data-type-tag>${record.type === 'income' ? '收入' : '支出'}</span> <span data-row-name></span></div><div class="item-meta"></div></div><div class="item-amount"></div>`
  const name = row.querySelector('[data-row-name]')
  name.replaceWith(document.createTextNode(record.name || '未命名'))
  renderLedgerRow(row, record)
  bindOverlayTrigger(row)
  row.addEventListener('click', () => populateDailySourceEditor(row))
  bindLedgerItemGestures(row)
  return row
}

function createTrashLedgerRow(record) {
  const row = document.createElement('div')
  row.className = 'list-item'
  row.dataset.recordId = record.id
  row.dataset.ledgerItem = record.type
  if (record.linkedRecordId) row.dataset.originalId = record.linkedRecordId
  row.innerHTML = `<div><div class="item-title"><span class="tag" data-type-tag></span> <span data-row-name></span></div><div class="item-meta"></div></div><div class="item-amount"></div>`
  row.querySelector('[data-row-name]').replaceWith(document.createTextNode(record.name || '未命名'))
  renderLedgerRow(row, record)
  addTrashActions(row)
  return row
}

function openLedgerActions(row) {
  const overlay = document.getElementById('ledger-actions-sheet')
  if (!overlay || !row) return
  overlay.__sourceRow = row
  const record = readLedgerRecords().find(item => item.id === row.dataset.recordId)
  overlay.querySelector('[data-ledger-action-title]').textContent = record?.name || '账单操作'
  overlay.querySelector('[data-ledger-action-caption]').textContent = `${row.dataset.ledgerItem === 'income' ? '收入' : row.dataset.ledgerItem === 'expense' ? '支出' : '退款/报销'} · 选择下一步操作`
  const adjustment = overlay.querySelector('[data-ledger-action="adjustment"]')
  const daily = overlay.querySelector('[data-ledger-action="daily"]')
  if (adjustment) adjustment.hidden = row.dataset.ledgerItem !== 'expense'
  if (daily) {
    daily.hidden = row.dataset.ledgerItem === 'adjustment'
    if (!daily.hidden) {
      const exists = readDailyTemplates().some(item => item.type === row.dataset.ledgerItem && item.key === normalizeDailyTemplateKey(row.dataset.dailyName))
      daily.textContent = `${exists ? '更新' : '加入'}日常${row.dataset.ledgerItem === 'expense' ? '支出' : '收入'}`
    }
  }
  openOverlay('ledger-actions-sheet')
}

function bindLedgerItemGestures(row) {
  if (!row || row.dataset.gestureBound === 'true' || row.closest('[data-view="trash"]')) return
  row.dataset.gestureBound = 'true'
  let startX = 0
  let startY = 0
  let timer = null
  let actionOpened = false
  const cancel = () => { clearTimeout(timer); timer = null; row.classList.remove('gesture-active') }
  row.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    startX = event.clientX
    startY = event.clientY
    actionOpened = false
    row.classList.add('gesture-active')
    timer = setTimeout(() => { actionOpened = true; cancel(); openLedgerActions(row) }, 520)
  })
  row.addEventListener('pointermove', event => {
    if (actionOpened) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (Math.abs(dy) > 18 || dx > 10) cancel()
    if (dx < -56 && Math.abs(dy) < 32) { actionOpened = true; cancel(); openLedgerActions(row) }
  })
  row.addEventListener('pointerup', cancel)
  row.addEventListener('pointercancel', cancel)
  row.addEventListener('click', event => {
    if (row.__allowActionClick) { row.__allowActionClick = false; actionOpened = false; return }
    if (!actionOpened) return
    event.preventDefault()
    event.stopImmediatePropagation()
    actionOpened = false
  }, true)
  row.addEventListener('contextmenu', event => { event.preventDefault(); openLedgerActions(row) })
  row.addEventListener('keydown', event => {
    if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); openLedgerActions(row) }
  })
}

function syncLedgerDomFromStore() {
  const records = readLedgerRecords()
  records.forEach(record => {
    if (document.querySelector(`[data-record-id="${record.id}"]`)) return
    const list = document.querySelector(record.lifecycle === 'trash' ? '[data-trash-list]' : '[data-ledger-list]')
    if (list) list.append(record.lifecycle === 'trash' ? createTrashLedgerRow(record) : createLedgerRow(record))
  })
  document.querySelectorAll('[data-record-id]').forEach(row => {
    const record = records.find(item => item.id === row.dataset.recordId)
    if (!record) return row.remove()
    renderLedgerRow(row, record)
    const expectedList = document.querySelector(record.lifecycle === 'trash' ? '[data-trash-list]' : '[data-ledger-list]')
    let host = row
    if (record.lifecycle === 'trash') {
      if (host !== row) { host.replaceWith(row); host = row }
      if (!row.querySelector('.row-actions')) addTrashActions(row)
    } else {
      row.querySelector('.row-actions')?.remove()
      if (record.type === 'adjustment') {
        row.dataset.open = 'adjustment-detail'
        bindAdjustmentRow(row)
      }
    }
    if (expectedList && !expectedList.contains(host)) expectedList.append(host)
  })
}

function addTrashActions(row) {
  row.querySelector('.row-actions')?.remove()
  const actions = document.createElement('div')
  actions.className = 'row-actions'
  const recordId = row.dataset.recordId
  const hasLinked = row.dataset.ledgerItem === 'expense' && readLedgerRecords().some(record => record.linkedRecordId === recordId)
  if (row.dataset.ledgerItem === 'expense') row.dataset.billId = recordId
  actions.innerHTML = `<button type="button" data-restore>恢复</button><button type="button" class="danger" data-open="${hasLinked ? 'purge-linked-dialog' : 'purge-dialog'}">永久删除</button>`
  row.append(actions)
  const restore = actions.querySelector('[data-restore]')
  restore.dataset.restoreBound = 'true'
  restore.addEventListener('click', () => {
    if (restoreRecordFromTrash(row)) showToast(row.dataset.billId ? '原支出与关联调整已恢复并重新计入报表' : '账目已恢复，并重新计入报表')
  })
  bindOverlayTrigger(actions.querySelector('[data-open]'))
}

function moveRecordToTrash(row) {
  const recordId = row?.dataset.recordId
  if (!recordId) return
  const records = readLedgerRecords()
  const snapshots = records.filter(record => record.id === recordId || record.linkedRecordId === recordId).map(record => ({ ...record }))
  const next = records.map(record => {
    if (record.id === recordId) return { ...record, lifecycle: 'trash' }
    if (record.linkedRecordId === recordId && record.state === 'active') return { ...record, lifecycle: 'trash', state: 'frozen' }
    return record
  })
  writeLedgerRecords(next)
  const movedIds = new Set(snapshots.map(item => item.id))
  document.querySelectorAll('[data-record-id]').forEach(item => { if (movedIds.has(item.dataset.recordId)) item.remove() })
  const trashList = document.querySelector('[data-trash-list]')
  next.filter(record => movedIds.has(record.id) && record.lifecycle === 'trash').forEach(record => trashList?.append(createTrashLedgerRow(record)))
  const undo = document.querySelector('[data-delete-undo]')
  if (undo) {
    undo.hidden = false
    undo.__snapshots = snapshots
    undo.querySelector('[data-delete-undo-name]').textContent = `${snapshots[0]?.name || '当前账目'}；关联调整将同步恢复。`
  }
  updateLedgerCounts()
  applyDetailFilters()
}

function restoreRecordFromTrash(row) {
  const recordId = row?.dataset.recordId
  if (!recordId) return
  const currentRecords = readLedgerRecords()
  const current = currentRecords.find(record => record.id === recordId)
  if (current?.type === 'adjustment' && current.linkedRecordId && currentRecords.find(record => record.id === current.linkedRecordId)?.lifecycle !== 'active') {
    showToast('请先恢复关联原支出，再恢复这条调整')
    return false
  }
  const records = currentRecords.map(record => {
    if (record.id === recordId) return { ...record, lifecycle: 'active', state: record.type === 'adjustment' ? 'active' : record.state }
    if (record.linkedRecordId === recordId && record.state === 'frozen') return { ...record, lifecycle: 'active', state: 'active' }
    return record
  })
  writeLedgerRecords(records)
  row.querySelector('.row-actions')?.remove()
  document.querySelector('[data-ledger-list]')?.append(row)
  const linked = records.filter(record => record.linkedRecordId === recordId && record.lifecycle === 'active')
  linked.forEach(record => {
    const linkedRow = document.querySelector(`[data-record-id="${record.id}"]`)
    if (linkedRow) { linkedRow.querySelector('.row-actions')?.remove(); renderLedgerRow(linkedRow, record); document.querySelector('[data-ledger-list]')?.append(linkedRow) }
  })
  updateLedgerCounts()
  applyDetailFilters()
  return true
}

function initBillDetails() {
  if (!document.querySelector('[data-page="details"], body[data-page="details"]')) return
  mountDetailLifecycleControls()
  syncLedgerDomFromStore()
  const context = document.querySelector('[data-drill-context]')
  const params = new URLSearchParams(location.search)
  const detailPreferences = getPreferences()
  const detailRange = document.querySelector('[data-detail-range]')
  let savedDetailFilters = null
  try { savedDetailFilters = JSON.parse(sessionStorage.getItem(detailFilterStorageKey) || 'null') } catch (error) { savedDetailFilters = null }
  let initialDetailFilters = savedDetailFilters || { range: detailPreferences.detailRange, type: 'all', funding: fundingFilterAllValue, keyword: '', lifecycle: 'active' }
  if (params.get('source') !== 'reports') initialDetailFilters = { ...initialDetailFilters, drillDimension: '', drillValue: '' }
  if (params.get('source') === 'reports') {
    let returnContext = null
    try { returnContext = JSON.parse(sessionStorage.getItem('bill-report-return') || 'null') } catch (error) { returnContext = null }
    const scope = params.get('scope')
    const dimension = params.get('dimension') || ''
    const value = params.get('value') || ''
    const type = dimension === 'adjustment' ? 'adjustment' : dimension === 'type' && value.includes('收入') ? 'income' : dimension === 'type' && value.includes('支出') ? 'expense' : ['expense', 'income'].includes(scope) ? scope : 'all'
    initialDetailFilters = {
      range: params.get('range') || returnContext?.filterValues?.range || detailPreferences.detailRange,
      type,
      funding: returnContext?.filterValues?.funding || fundingFilterAllValue,
      keyword: returnContext?.filterValues?.keyword || '',
      lifecycle: 'active',
      drillDimension: dimension,
      drillValue: value
    }
  }
  restoreRangeControl(detailRange, document.querySelector('[data-detail-range-start]'), document.querySelector('[data-detail-range-end]'), initialDetailFilters.range)
  Object.entries(initialDetailFilters).filter(([key]) => !['range', 'keyword', 'drillDimension', 'drillValue'].includes(key)).forEach(([key, value]) => {
    const control = document.querySelector(`[data-detail-filter-key="${key}"]`)
    if (control && [...control.options || []].some(option => option.value === value) || control?.tagName === 'INPUT') control.value = value
  })
  const globalSearch = document.querySelector('[data-detail-global-search]')
  if (globalSearch) globalSearch.value = initialDetailFilters.keyword || ''
  if (initialDetailFilters.lifecycle === 'trash') {
    document.querySelectorAll('[data-bill-tab]').forEach(button => {
      const active = button.dataset.billTab === 'trash'
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
    document.querySelectorAll('[data-view]').forEach(view => { view.hidden = view.dataset.view !== 'trash' })
  }
  const detailSummary = document.querySelector('[data-detail-filter-summary]')
  if (detailSummary) detailSummary.textContent = `${detailPreferences.detailRange} · 全部账目`
  if (context && params.get('source') === 'reports') {
    context.hidden = false
    const reportScope = reportScopes[params.get('scope')] ? params.get('scope') : 'overview'
    const scopeLabel = reportScopeLabels[reportScope]
    const dimensionLabel = getReportDimensionLabel(reportScope, params.get('dimension'))
    context.querySelector('[data-drill-context-text]').textContent = `来自${scopeLabel}报表 · ${dimensionLabel}：${params.get('value') || '全部'} · ${params.get('range') || ''}`
    const back = context.querySelector('[data-return-reports]')
    back?.addEventListener('click', event => {
      event.preventDefault()
      const saved = sessionStorage.getItem('bill-report-return')
      location.href = `reports.html?restore=${encodeURIComponent(saved || '')}`
    })
  }
  document.querySelectorAll('[data-bill-tab]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-bill-tab]').forEach(item => {
      item.classList.toggle('active', item === button)
      item.setAttribute('aria-pressed', String(item === button))
    })
    document.querySelectorAll('[data-view]').forEach(view => { view.hidden = view.dataset.view !== button.dataset.billTab })
    applyDetailFilters(readDetailFilterState())
  }))
  document.querySelectorAll('[data-ledger-item="adjustment"][data-open="adjustment-detail"]').forEach(bindAdjustmentRow)
  document.querySelectorAll('[data-restore]:not([data-restore-bound])').forEach(button => button.addEventListener('click', () => {
    const row = button.closest('.list-item')
    const billId = row?.dataset.billId
    if (restoreRecordFromTrash(row)) showToast(billId ? '原支出与关联调整已恢复并重新计入报表' : '账单已恢复，并重新计入报表')
  }))
  const linkedTrash = [...document.querySelectorAll('[data-view="trash"] [data-ledger-item="expense"]')].find(item => item.textContent.includes('旧雨伞'))
  if (linkedTrash) {
    const meta = linkedTrash.querySelector('.item-meta')
    if (meta) meta.textContent = '8月3日移入 · 关联调整 1 条已冻结 · 不参与报表'
    const purge = linkedTrash.querySelector('[data-open="purge-dialog"]')
    if (purge) purge.dataset.open = 'purge-linked-dialog'
  }
  document.querySelectorAll('[data-adjustment-action]').forEach(button => button.addEventListener('click', () => {
    const detail = button.closest('.overlay')
    const row = detail.__adjustmentRow
    if (!row) return
    const action = button.dataset.adjustmentAction
    const recordId = row.dataset.recordId
    if (action === 'revoke') {
      updateLedgerRecord(recordId, { lifecycle: 'trash', state: 'revoked' })
    }
    closeOverlay(detail)
    syncLedgerDomFromStore()
    updateLedgerCounts()
    applyDetailFilters()
    showToast('当前调整已撤销并移入回收站，相关报表已刷新')
  }))
  document.querySelectorAll('[data-purge-confirm]').forEach(button => button.addEventListener('click', () => {
    const overlay = button.closest('.overlay')
    const row = overlay?.__sourceTrigger?.closest('.list-item')
    const billId = row?.dataset.billId
    const recordId = row?.dataset.recordId
    const sourceId = billId || recordId
    const deleteLinked = overlay?.id === 'purge-linked-dialog'
    const records = readLedgerRecords().filter(record => record.id !== recordId && (!deleteLinked || record.linkedRecordId !== sourceId))
    writeLedgerRecords(records)
    if (billId) document.querySelector(`[data-original-id="${billId}"]`)?.remove()
    row?.remove()
    closeOverlay(overlay)
    updateLedgerCounts()
    showToast(button.dataset.purgeConfirm)
  }))
  document.querySelectorAll('[data-ledger-type]').forEach(button => button.addEventListener('click', () => {
    const type = button.dataset.ledgerType
    const filters = { ...readDetailFilterState(), type }
    const select = document.querySelector('[data-detail-filter-key="type"]')
    if (select) select.value = type
    applyDetailFilters(filters)
  }))
  document.querySelectorAll('[data-ledger-action]').forEach(button => button.addEventListener('click', () => {
    const actions = button.closest('.overlay')
    const row = actions.__sourceRow
    if (!row) return
    const action = button.dataset.ledgerAction
    closeOverlay(actions)
    if (action === 'edit') { row.__allowActionClick = true; row.click() }
    if (action === 'adjustment') prepareLinkedAdjustment(row)
    if (action === 'daily') {
      const template = createDailyTemplateFromSourceRow(row)
      const existing = upsertDailyTemplate(template)
      showToast(`${existing ? '已更新' : '已加入'}日常${template.type === 'expense' ? '支出' : '收入'}“${template.name}”`)
    }
    if (action === 'trash') {
      moveRecordToTrash(row)
      showToast('账目已移入回收站，可立即撤销')
    }
  }))
  document.querySelector('[data-undo-delete]')?.addEventListener('click', event => {
    const undo = event.currentTarget.closest('[data-delete-undo]')
    const snapshots = undo.__snapshots || []
    if (!snapshots.length) return
    const records = readLedgerRecords().map(record => snapshots.find(snapshot => snapshot.id === record.id) || record)
    writeLedgerRecords(records)
    snapshots.forEach(snapshot => {
      const row = document.querySelector(`[data-record-id="${snapshot.id}"]`)
      if (!row) return
      row.querySelector('.row-actions')?.remove()
      renderLedgerRow(row, snapshot)
      document.querySelector('[data-ledger-list]')?.append(row)
    })
    undo.hidden = true
    updateLedgerCounts()
    applyDetailFilters()
    showToast('已撤销删除，账目和关联调整恢复生效')
  })
  let searchTimer
  globalSearch?.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => applyDetailFilters(readDetailFilterState()), 180)
  })
  document.querySelector('[data-ledger-load-more]')?.addEventListener('click', () => {
    detailVisibleLimit += 20
    applyDetailFilters(readDetailFilterState())
  })
  applyDetailFilters(initialDetailFilters)
  updateLedgerCounts()
}

function updateUserFilter() {
  const search = document.querySelector('[data-user-search]')
  const status = document.querySelector('[data-user-status-filter]')
  if (!search || !status) return
  const keyword = search.value.trim().toLocaleLowerCase('zh-CN')
  let visible = 0
  document.querySelectorAll('[data-user-row]').forEach(row => {
    const matchesKeyword = !keyword || row.dataset.username.toLocaleLowerCase('zh-CN').includes(keyword)
    const rowStatus = row.querySelector('.tag')?.textContent.trim()
    const matchesStatus = status.value === 'all' || rowStatus === status.value
    row.hidden = !(matchesKeyword && matchesStatus)
    if (!row.hidden) visible += 1
  })
  document.querySelector('[data-user-empty]').hidden = visible > 0
  document.querySelector('[data-user-count]').textContent = `当前显示 ${visible} 个用户`
}

function setUserStatus(row, status) {
  const tag = row?.querySelector('.tag')
  if (!tag) return
  tag.textContent = status
  tag.className = `tag ${status === '正常' ? 'success' : status === '注销处理中' ? 'danger' : 'warning'}`
  const actions = row.querySelector('[data-user-actions]')
  if (actions) {
    actions.disabled = status === '注销处理中'
    actions.textContent = status === '注销处理中' ? '处理中' : '更多'
  }
}

function syncUserActionSheet(row) {
  const sheet = document.getElementById('user-actions-sheet')
  if (!sheet || !row) return
  const status = row.querySelector('.tag')?.textContent.trim()
  const processing = status === '注销处理中'
  sheet.__userRow = row
  sheet.querySelector('[data-user-action-name]').textContent = `${row.dataset.username} · ${status}`
  sheet.querySelector('[data-reset-result]').hidden = true
  sheet.querySelector('[data-reset-password]').hidden = processing
  sheet.querySelector('[data-user-delete]').hidden = processing
  const statusButton = sheet.querySelector('[data-user-status-action]')
  statusButton.hidden = processing
  statusButton.dataset.nextStatus = status === '停用' ? 'restore' : 'disable'
  statusButton.querySelector('[data-user-status-action-label]').textContent = status === '停用' ? '恢复用户' : '停用用户'
}

function appendAdminLog(action, objectName, detail) {
  const body = document.querySelector('[data-log-table-body]')
  if (!body) return
  const row = document.createElement('tr')
  row.dataset.logDetail = `${detail}；不含账目数据`
  row.innerHTML = '<td>刚刚</td><td>admin</td><td></td><td></td><td><span class="tag success">成功</span></td><td><div class="row-actions"><button data-log-view>查看</button></div></td>'
  row.children[2].textContent = action
  row.children[3].textContent = objectName
  body.prepend(row)
  bindLogDetail(row)
  const panel = document.querySelector('[data-log-filter-panel]')
  applyLogFilters(panel?.__appliedFilters || {})
}

function bindUserRow(row) {
  row.querySelector('[data-user-detail]')?.addEventListener('click', () => {
    const sheet = document.getElementById('user-detail-sheet')
    const values = sheet.querySelectorAll('.setting-value')
    values[0].textContent = row.dataset.username
    const status = row.querySelector('.tag')?.textContent.trim()
    const statusTag = sheet.querySelector('.tag')
    statusTag.textContent = status
    statusTag.className = `tag ${status === '正常' ? 'success' : status === '注销处理中' ? 'danger' : 'warning'}`
    openOverlay('user-detail-sheet')
  })
  row.querySelector('[data-user-actions]')?.addEventListener('click', () => {
    syncUserActionSheet(row)
    openOverlay('user-actions-sheet')
  })
}

function createUserRow(username) {
  const row = document.createElement('tr')
  row.dataset.userRow = ''
  row.dataset.username = username
  row.innerHTML = '<td><strong></strong><div class="caption">新租户</div></td><td><span class="tag warning">待首次登录</span></td><td>2026-08-14</td><td>尚未登录</td><td><div class="row-actions"><button data-user-detail>详情</button><button data-user-actions>更多</button></div></td>'
  row.querySelector('strong').textContent = username
  bindUserRow(row)
  return row
}

function initAdmin() {
  const switchPanel = key => {
    document.querySelectorAll('[data-admin-panel]').forEach(panel => { panel.hidden = panel.dataset.adminPanel !== key })
    document.querySelectorAll('[data-admin-nav]').forEach(button => button.classList.toggle('active', button.dataset.adminNav === key))
    closeOverlay(document.getElementById('admin-nav-sheet'))
  }
  document.querySelectorAll('[data-admin-nav]').forEach(button => button.addEventListener('click', () => switchPanel(button.dataset.adminNav)))
  document.querySelector('[data-user-search]')?.addEventListener('input', updateUserFilter)
  document.querySelector('[data-user-status-filter]')?.addEventListener('change', updateUserFilter)
  document.querySelectorAll('[data-user-row]').forEach(bindUserRow)
  document.querySelectorAll('[data-create-user]').forEach(button => button.addEventListener('click', () => {
    const dialog = button.closest('.dialog')
    if (!validateEntry(dialog)) return
    const usernameInput = dialog.querySelector('#new-username')
    const username = usernameInput.value.trim()
    const duplicate = [...document.querySelectorAll('[data-user-row]')].some(row => row.dataset.username.toLocaleLowerCase('zh-CN') === username.toLocaleLowerCase('zh-CN'))
    usernameInput.closest('.field').classList.toggle('invalid', duplicate)
    if (duplicate) return usernameInput.focus()
    setButtonLoading(button, true, '创建中…')
    setTimeout(() => {
      setButtonLoading(button, false)
      document.querySelector('[data-user-table-body]').append(createUserRow(username))
      appendAdminLog('创建用户', username, '创建普通用户并生成一次性临时密码')
      updateUserFilter()
      closeOverlay(button.closest('.overlay'))
      showToast('用户已创建；临时密码：A7kP9mQ2xR4tV8zN（仅本次展示）')
      dialog.querySelectorAll('input').forEach(input => { input.value = '' })
    }, 650)
  }))
  document.querySelectorAll('[data-admin-refresh]').forEach(button => button.addEventListener('click', () => {
    setButtonLoading(button, true, '刷新中…')
    setTimeout(() => {
      setButtonLoading(button, false)
      if (button.dataset.adminRefresh === 'overview') document.querySelector('[data-health-time]').textContent = '刚刚检查 · 全部服务正常'
      if (button.dataset.adminRefresh === 'logs') {
        appendAdminLog('刷新日志', '操作日志', '管理员手动刷新操作日志；读取成功')
      }
      showToast('数据已刷新')
    }, 650)
  }))
  document.querySelectorAll('[data-log-detail]').forEach(bindLogDetail)
  updateUserFilter()
}

function bindLogDetail(row) {
  row.querySelector('[data-log-view]')?.addEventListener('click', () => {
    document.querySelector('[data-log-detail-title]').textContent = `${row.children[2].textContent} · ${row.children[4].textContent}`
    document.querySelector('[data-log-detail-content]').textContent = row.dataset.logDetail
    openOverlay('log-detail-sheet')
  })
}

function readLogFilterDraft() {
  return Object.fromEntries([...document.querySelectorAll('[data-log-filter]')].map(control => [control.dataset.logFilter, control.value.trim()]))
}

function applyLogFilters(filters = {}) {
  const rows = [...document.querySelectorAll('[data-log-table-body] tr')]
  if (!rows.length) return
  let visible = 0
  rows.forEach(row => {
    const values = {
      time: row.children[0].textContent.trim(),
      admin: row.children[1].textContent.trim(),
      action: row.children[2].textContent.trim(),
      object: row.children[3].textContent.trim(),
      result: row.children[4].textContent.trim()
    }
    const textMatch = ['admin', 'action', 'object'].every(key => !filters[key] || values[key].toLocaleLowerCase('zh-CN').includes(filters[key].toLocaleLowerCase('zh-CN')))
    const resultMatch = !filters.result || filters.result === 'all' || values.result === filters.result
    const timeMatch = !filters.time
      || filters.time === 'all'
      || values.time.startsWith(filters.time)
      || (filters.time === '今天' && values.time === '刚刚')
    row.hidden = !(textMatch && resultMatch && timeMatch)
    if (!row.hidden) visible += 1
  })
  const empty = document.querySelector('[data-log-filter-empty]')
  const count = document.querySelector('[data-log-filter-count]')
  if (empty) empty.hidden = visible > 0
  if (count) count.textContent = `当前显示 ${visible} 条日志`
}

function initLogFilters() {
  const panel = document.querySelector('[data-log-filter-panel]')
  if (!panel) return
  panel.__appliedFilters = {}
  applyLogFilters(panel.__appliedFilters)
  document.querySelector('[data-log-filter-apply]')?.addEventListener('click', event => {
    const button = event.currentTarget
    const error = panel.querySelector('[data-log-filter-error]')
    const nextFilters = readLogFilterDraft()
    error.hidden = true
    setButtonLoading(button, true, '筛选中…')
    setTimeout(() => {
      setButtonLoading(button, false)
      const failOnce = new URLSearchParams(location.search).get('logs') === 'error' && button.dataset.failureShown !== 'true'
      if (failOnce) {
        button.dataset.failureShown = 'true'
        error.hidden = false
        return
      }
      panel.__appliedFilters = nextFilters
      applyLogFilters(nextFilters)
    }, 500)
  })
  document.querySelector('[data-log-filter-clear]')?.addEventListener('click', () => {
    panel.querySelectorAll('[data-log-filter]').forEach(control => { control.value = control.tagName === 'SELECT' ? 'all' : '' })
    panel.querySelector('[data-log-filter-error]').hidden = true
    panel.__appliedFilters = {}
    applyLogFilters(panel.__appliedFilters)
  })
}

function openProductMerge(sourceRow) {
  const sheet = document.getElementById('product-merge-sheet')
  const target = sheet?.querySelector('[data-product-merge-target]')
  if (!sheet || !target) return
  const sourceName = sourceRow.querySelector('input').value.trim()
  const candidates = [...sourceRow.parentElement.querySelectorAll('[data-dictionary-row]')]
    .filter(row => row !== sourceRow && row.dataset.disabled !== 'true')
  sheet.__sourceRow = sourceRow
  sheet.querySelector('[data-product-merge-source]').textContent = sourceName
  sheet.querySelector('[data-product-merge-impact]').textContent = `${sourceRow.dataset.impactCount || '0'} 条`
  target.replaceChildren(...candidates.map(row => {
    const option = document.createElement('option')
    option.value = row.querySelector('input').value.trim()
    option.textContent = option.value
    return option
  }))
  if (!candidates.length) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = '暂无可合并的启用商品'
    target.append(option)
  }
  openOverlay('product-merge-sheet')
}

function reconcileFundingPreference() {
  const fallback = getDefaultFundingChannel()
  let stored = {}
  let sessionState = {}
  try { stored = JSON.parse(localStorage.getItem(preferenceStorageKey) || '{}') } catch (error) { stored = {} }
  try { sessionState = JSON.parse(sessionStorage.getItem(preferenceSessionKey) || '{}') } catch (error) { sessionState = {} }
  stored.fundingChannel = resolveFundingChannelId(stored.fundingChannel) || fallback
  const sessionItem = sessionState.fundingChannel
  const sessionValue = typeof sessionItem === 'object' && sessionItem !== null ? sessionItem.value : sessionItem
  const sessionId = resolveFundingChannelId(sessionValue)
  if (sessionValue && sessionId) {
    sessionState.fundingChannel = typeof sessionItem === 'object' && sessionItem !== null ? { ...sessionItem, value: sessionId } : { value: sessionId, status: 'error' }
  } else if (sessionValue) {
    delete sessionState.fundingChannel
  }
  localStorage.setItem(preferenceStorageKey, JSON.stringify(normalizePreferences(stored)))
  if (Object.keys(sessionState).length) sessionStorage.setItem(preferenceSessionKey, JSON.stringify(sessionState))
  else sessionStorage.removeItem(preferenceSessionKey)
}

function persistFundingDictionaryRows(container) {
  const items = [...container.querySelectorAll('[data-dictionary-row]')].map(row => ({
    id: row.dataset.dictionaryId || createFundingChannelId(),
    name: row.querySelector('input').value.trim(),
    enabled: row.dataset.disabled !== 'true'
  }))
  if (items.some(item => !item.name) || new Set(items.map(item => item.name)).size !== items.length || !items.some(item => item.enabled)) return false
  writeFundingDictionary(items)
  reconcileFundingPreference()
  renderFundingControls()
  renderProfilePreferences()
  return true
}

function createDictionaryRow(dictionaryName, value, disabled = false, metaText = '历史引用保留', impactCount = 0, dictionaryId = '') {
  const row = document.createElement('div')
  row.className = 'list-item'
  row.dataset.dictionaryRow = ''
  row.dataset.disabled = String(disabled)
  row.dataset.impactCount = String(impactCount)
  if (dictionaryName === '资金渠道') row.dataset.dictionaryId = dictionaryId || createFundingChannelId()
  const content = document.createElement('div')
  const input = document.createElement('input')
  input.className = 'control'
  input.value = value
  input.dataset.lastValue = value
  input.setAttribute('aria-label', `${dictionaryName}名称`)
  const meta = document.createElement('div')
  meta.className = 'item-meta'
  meta.textContent = metaText
  const actions = document.createElement('div')
  actions.className = 'row-actions'
  const move = document.createElement('button')
  move.dataset.dictionaryMove = ''
  move.textContent = '上移'
  const merge = document.createElement('button')
  merge.dataset.productMerge = ''
  merge.textContent = '合并'
  merge.hidden = dictionaryName !== '商品'
  merge.disabled = disabled
  const toggle = document.createElement('button')
  toggle.dataset.dictionaryToggle = ''
  toggle.textContent = disabled ? '恢复' : '停用'
  content.append(input, meta)
  actions.append(move, merge, toggle)
  row.append(content, actions)
  input.addEventListener('change', () => {
    if (dictionaryName === '资金渠道' && !persistFundingDictionaryRows(row.parentElement)) {
      input.value = input.dataset.lastValue
      return showToast('资金渠道名称不能为空或重复')
    }
    input.dataset.lastValue = input.value.trim()
    showToast(`${dictionaryName}已改名并刷新引用展示`)
  })
  move.addEventListener('click', () => {
    if (row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling)
    if (dictionaryName === '资金渠道') persistFundingDictionaryRows(row.parentElement)
    showToast(`${dictionaryName}排序已更新`)
  })
  merge.addEventListener('click', () => openProductMerge(row))
  toggle.addEventListener('click', () => {
    const nextDisabled = row.dataset.disabled !== 'true'
    if (dictionaryName === '资金渠道' && nextDisabled) {
      const enabledCount = [...row.parentElement.querySelectorAll('[data-dictionary-row]')].filter(item => item.dataset.disabled !== 'true').length
      if (enabledCount <= 1) return showToast('至少保留一个启用资金渠道')
    }
    row.dataset.disabled = String(nextDisabled)
    toggle.textContent = nextDisabled ? '恢复' : '停用'
    merge.disabled = nextDisabled
    meta.textContent = nextDisabled ? '已停用项不进入新填报' : '已恢复，可用于新填报'
    if (dictionaryName === '资金渠道') persistFundingDictionaryRows(row.parentElement)
    showToast(`${dictionaryName}${nextDisabled ? '已停用' : '已恢复'}`)
  })
  return row
}

function initDictionaries() {
  const title = document.querySelector('[data-dictionary-title]')
  const list = document.querySelector('[data-dictionary-list]')
  let currentName = ''
  const renderList = name => {
    if (name === '资金渠道') {
      list.replaceChildren(...readFundingDictionary().map(item => createDictionaryRow(name, item.name, !item.enabled, item.enabled ? '启用 · 所有账目页面共用' : '已停用项不进入新填报', 0, item.id)))
      return
    }
    list.replaceChildren(
      createDictionaryRow(name, `${name}示例一`, false, '历史引用保留', name === '商品' ? 12 : 0),
      createDictionaryRow(name, `${name}示例二`, name !== '商品', name === '商品' ? '启用 · 可作为合并目标' : '已停用项不进入新填报', name === '商品' ? 5 : 0)
    )
  }
  document.querySelectorAll('[data-dictionary]').forEach(button => button.addEventListener('click', () => {
    if (!title || !list) return
    const name = button.dataset.dictionary
    currentName = name
    title.textContent = `${name}管理`
    renderList(name)
    closeOverlay(button.closest('.overlay'))
    openOverlay('dictionary-sheet')
  }))
  document.querySelector('[data-dictionary-add]')?.addEventListener('click', () => {
    const value = document.querySelector('[data-dictionary-new]')?.value.trim()
    if (!value) return showToast(`请输入${currentName}名称`)
    if (currentName === '资金渠道' && readFundingDictionary().some(item => item.name === value)) return showToast('资金渠道名称不能重复')
    list.prepend(createDictionaryRow(currentName, value, false, '刚刚新增 · 启用'))
    if (currentName === '资金渠道') persistFundingDictionaryRows(list)
    document.querySelector('[data-dictionary-new]').value = ''
    showToast(`${currentName}“${value}”已新增`)
  })
  document.querySelector('[data-product-merge-confirm]')?.addEventListener('click', event => {
    const sheet = event.currentTarget.closest('.sheet')
    const overlay = sheet.closest('.overlay')
    const target = sheet.querySelector('[data-product-merge-target]')
    if (!target.value) {
      target.closest('.field').classList.add('invalid')
      return target.focus()
    }
    const sourceRow = overlay.__sourceRow
    const sourceName = sourceRow?.querySelector('input').value.trim()
    const impactCount = Number(sourceRow?.dataset.impactCount || 0)
    const targetRow = [...document.querySelectorAll('[data-dictionary-row]')]
      .find(row => row !== sourceRow && row.querySelector('input').value.trim() === target.value)
    if (!sourceRow || !targetRow) return
    targetRow.dataset.impactCount = String(Number(targetRow.dataset.impactCount || 0) + impactCount)
    targetRow.querySelector('.item-meta').textContent = `已合并“${sourceName}” · ${impactCount} 条历史账单引用已迁移`
    sourceRow.remove()
    closeOverlay(overlay)
    showToast(`商品“${sourceName}”已合并到“${target.value}”`)
  })
  const requested = new URLSearchParams(location.search).get('dictionary')
  if (requested) [...document.querySelectorAll('[data-dictionary]')].find(button => button.dataset.dictionary === requested)?.click()
}

function initReportFilters() {
  const select = document.querySelector('[data-report-filter-scope]')
  if (select) {
    const update = () => {
      document.querySelectorAll('[data-filter-for]').forEach(field => {
        const scopes = field.dataset.filterFor.split(' ')
        field.hidden = !scopes.includes(select.value)
        if (field.hidden) field.querySelectorAll('input, select').forEach(input => { input.value = input.tagName === 'SELECT' ? input.options[0].value : '' })
      })
    }
    select.addEventListener('change', update)
    update()
  }
  const range = document.querySelector('[data-report-range]')
  range?.addEventListener('change', () => setRangeValidation(range, document.querySelector('[data-report-range-start]'), document.querySelector('[data-report-range-end]')))
  const detailRange = document.querySelector('[data-detail-range]')
  detailRange?.addEventListener('change', () => setRangeValidation(detailRange, document.querySelector('[data-detail-range-start]'), document.querySelector('[data-detail-range-end]')))
}

function renderProfilePreferences() {
  const state = getPreferenceState()
  const preferences = state.values
  const entryTypeLabels = { expense: '支出', income: '收入' }
  const themeLabels = { system: '跟随系统', light: '白天', dark: '夜晚' }
  document.querySelectorAll('[data-preference-value]').forEach(value => {
    const key = value.dataset.preferenceValue
    const status = state.fields[key].status === 'pending' ? '保存中' : state.fields[key].status === 'error' ? '待重试' : ''
    const current = key === 'fundingChannel' ? getFundingChannelName(preferences[key]) : preferences[key]
    value.textContent = key === 'entryType'
      ? `${entryTypeLabels[preferences.entryType]} · 自动记录`
      : `${current}${status ? ` · ${status}` : ''}`
  })
  const themeStatus = document.querySelector('[data-theme-save-status]')
  if (themeStatus) {
    const statusLabel = state.fields.theme.status === 'pending' ? '保存中' : state.fields.theme.status === 'error' ? '待重试' : '已保存'
    themeStatus.textContent = `当前：${themeLabels[preferences.theme]} · ${statusLabel}`
  }
}

function selectPreferenceChip(group, selectedValue) {
  group?.querySelectorAll('.chip').forEach(chip => {
    const active = chip.dataset.fundingId ? chip.dataset.fundingId === selectedValue : chip.textContent.trim() === selectedValue
    chip.classList.toggle('active', active)
    chip.setAttribute('aria-pressed', String(active))
  })
}

function initProfilePreferences() {
  if (!document.querySelector('[data-preference-value]')) return
  renderProfilePreferences()
  const paymentOverlay = document.getElementById('payment-pref')
  document.querySelector('[data-open="payment-pref"]')?.addEventListener('click', () => {
    const state = getPreferenceState()
    selectPreferenceChip(paymentOverlay.querySelector('[data-preference-options="fundingChannel"]'), getPreferences().fundingChannel)
    paymentOverlay.querySelector('[data-preference-error="fundingChannel"]').hidden = state.fields.fundingChannel.status !== 'error'
  })
  document.querySelector('[data-preference-save="fundingChannel"]')?.addEventListener('click', event => {
    const button = event.currentTarget
    const selected = paymentOverlay.querySelector('[data-preference-options="fundingChannel"] .chip.active')?.dataset.fundingId || getPreferences().fundingChannel
    const error = paymentOverlay.querySelector('[data-preference-error="fundingChannel"]')
    error.hidden = true
    savePreference(button, { fundingChannel: selected }, {
      onPending: () => renderProfilePreferences(),
      onFailure: () => {
        error.hidden = false
        renderProfilePreferences()
      },
      onSuccess: () => {
        renderProfilePreferences()
        closeOverlay(paymentOverlay)
        showToast('默认资金渠道已保存并用于新填报')
      }
    })
  })
  const rangeOverlay = document.getElementById('range-pref')
  document.querySelectorAll('[data-preference-range]').forEach(trigger => trigger.addEventListener('click', () => {
    const key = trigger.dataset.preferenceRange
    rangeOverlay.__preferenceKey = key
    rangeOverlay.querySelector('[data-range-pref-title]').textContent = key === 'detailRange' ? '明细默认范围' : '报表默认范围'
    rangeOverlay.querySelector('[data-range-pref-select]').value = getPreferences()[key]
    rangeOverlay.querySelector('[data-preference-error="range"]').hidden = getPreferenceState().fields[key].status !== 'error'
    openOverlay('range-pref')
  }))
  document.querySelector('[data-preference-save="range"]')?.addEventListener('click', event => {
    const button = event.currentTarget
    const key = rangeOverlay.__preferenceKey
    if (!['detailRange', 'reportRange'].includes(key)) return
    const selected = rangeOverlay.querySelector('[data-range-pref-select]').value
    const error = rangeOverlay.querySelector('[data-preference-error="range"]')
    error.hidden = true
    savePreference(button, { [key]: selected }, {
      onPending: () => renderProfilePreferences(),
      onFailure: () => {
        error.hidden = false
        renderProfilePreferences()
      },
      onSuccess: () => {
        renderProfilePreferences()
        closeOverlay(rangeOverlay)
        showToast(`${key === 'detailRange' ? '明细' : '报表'}默认范围已保存`)
      }
    })
  })
  const resetDialog = document.getElementById('preference-reset-dialog')
  document.querySelector('[data-open="preference-reset-dialog"]')?.addEventListener('click', () => {
    resetDialog.querySelector('[data-preference-error="reset"]').hidden = true
  })
  document.querySelector('[data-preference-reset]')?.addEventListener('click', event => {
    const button = event.currentTarget
    const error = resetDialog.querySelector('[data-preference-error="reset"]')
    error.hidden = true
    savePreference(button, preferenceDefaults, {
      loadingText: '恢复中…',
      optimistic: false,
      onFailure: () => { error.hidden = false },
      onSuccess: preferences => {
        applyTheme(preferences.theme)
        renderProfilePreferences()
        closeOverlay(resetDialog)
        showToast('全部偏好已恢复默认')
      }
    })
  })
}

function initProfileActions() {
  document.querySelector('[data-password-save]')?.addEventListener('click', event => {
    const sheet = event.currentTarget.closest('.sheet')
    const current = sheet.querySelector('[data-current-password]')
    current.closest('.field').querySelector('.field-error').textContent = '请输入当前密码'
    if (!validateEntry(sheet)) return
    const currentInvalid = current.value !== 'LedgerSafe!2026A'
    current.closest('.field').classList.toggle('invalid', currentInvalid)
    if (currentInvalid) {
      current.closest('.field').querySelector('.field-error').textContent = '当前密码不正确'
      return current.focus()
    }
    if (!validateNewPassword(sheet, '[data-new-password]', '[data-password-confirm]')) return
    setButtonLoading(event.currentTarget, true, '更新中…')
    setTimeout(() => {
      setButtonLoading(event.currentTarget, false)
      closeOverlay(sheet.closest('.overlay'))
      showToast('密码已更新，其他会话已失效')
    }, 650)
  })
  document.querySelector('[data-account-delete]')?.addEventListener('click', event => {
    const button = event.currentTarget
    const overlay = button.closest('.overlay')
    const error = overlay.querySelector('[data-account-error]')
    if (button.dataset.accountState === 'running') return
    button.dataset.accountState = 'running'
    error.hidden = true
    setButtonLoading(button, true, '提交中…')
    setTimeout(() => {
      const shouldFailOnce = new URLSearchParams(location.search).get('account') === 'error' && button.dataset.failureShown !== 'true'
      button.dataset.accountState = 'idle'
      setButtonLoading(button, false)
      if (shouldFailOnce) {
        button.dataset.failureShown = 'true'
        error.hidden = false
        return
      }
      closeOverlay(overlay)
      sessionStorage.clear()
      const processing = document.querySelector('[data-account-processing]')
      document.querySelectorAll('[data-page-content] > *').forEach(child => { child.hidden = child !== processing })
      processing.hidden = false
      document.querySelector('.bottom-nav').hidden = true
      setTimeout(() => { location.href = 'login.html?reason=account-cancelled' }, 900)
    }, 650)
  })
}

function clearCsvDownload(button) {
  const existing = button.parentElement.querySelector('[data-csv-download]')
  if (!existing) return
  if (existing.href.startsWith('blob:')) URL.revokeObjectURL(existing.href)
  existing.remove()
}

function createCsvDownload(button, filename, rows) {
  const csv = rows.map(row => row.map(value => {
    const text = String(value ?? '')
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
    return `"${safe.replaceAll('"', '""')}"`
  }).join(',')).join('\r\n')
  clearCsvDownload(button)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  link.download = filename
  link.dataset.csvDownload = ''
  link.hidden = true
  button.insertAdjacentElement('afterend', link)
  link.click()
}

function ledgerCsvRows(records) {
  const headers = ['记录ID', '账目类型', '调整类型', '关联账目ID', '状态', '业务时间', '名称', '付款方', '一级分类', '二级分类', '单位', '单价', '数量', '金额', '资金渠道', '购买渠道', '地点', '备注', '生命周期']
  const typeLabels = { expense: '支出', income: '收入', adjustment: '退款/报销调整' }
  const allRecords = readLedgerRecords()
  return [headers, ...records.map(record => {
    const fundingId = recordFundingChannel(record, allRecords)
    return [
    record.id, typeLabels[record.type] || record.type, record.adjustmentType || '', record.linkedRecordId || '', record.state || '',
    record.occurredAt || '', record.name || '', record.payer || '', record.primaryCategory || record.category || '', record.secondaryCategory || '',
    record.unit || '', record.price || '', record.quantity || '', record.amount || '', fundingId ? getFundingChannelName(fundingId) : '',
    record.purchaseChannel || '', record.location || '', record.note || '', record.lifecycle === 'trash' ? '回收站' : '有效'
    ]
  })]
}

function recordsForExport(scope) {
  const records = readLedgerRecords()
  if (scope === 'all-ledger') return records
  let filters = { range: getPreferences().detailRange, type: 'all', keyword: '', funding: fundingFilterAllValue }
  try { filters = { ...filters, ...JSON.parse(sessionStorage.getItem(detailFilterStorageKey) || '{}') } } catch (error) { /* 保留安全默认值 */ }
  return filterLedgerRecords(records, filters, { lifecycle: filters.lifecycle === 'trash' ? 'trash' : 'active' })
}

function initExports() {
  document.querySelectorAll('[data-export-csv]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.exportState === 'running') return button.__cancelExport?.()
    clearCsvDownload(button)
    button.dataset.exportState = 'running'
    const value = button.querySelector('.setting-value')
    const isIconAction = button.classList.contains('icon-btn')
    if (value) {
      button.disabled = true
      value.textContent = '准备中…'
    } else if (isIconAction) {
      button.dataset.originalMarkup = button.innerHTML
      button.dataset.originalLabel = button.getAttribute('aria-label') || ''
      button.dataset.originalTitle = button.getAttribute('title') || ''
      button.innerHTML = icons.close
      button.setAttribute('aria-label', '取消导出')
      button.setAttribute('title', '取消导出')
      button.setAttribute('aria-busy', 'true')
    } else {
      setButtonLoading(button, true, '准备导出…')
    }
    const cancel = isIconAction ? null : document.createElement('button')
    if (cancel) {
      cancel.className = 'btn text'
      cancel.type = 'button'
      cancel.textContent = '取消导出'
      button.insertAdjacentElement('afterend', cancel)
    }
    const finish = message => {
      button.dataset.exportState = 'idle'
      button.disabled = false
      if (isIconAction) {
        button.innerHTML = button.dataset.originalMarkup
        button.setAttribute('aria-label', button.dataset.originalLabel)
        button.setAttribute('title', button.dataset.originalTitle)
        button.removeAttribute('aria-busy')
        delete button.dataset.originalMarkup
        delete button.dataset.originalLabel
        delete button.dataset.originalTitle
      } else if (!value) {
        setButtonLoading(button, false)
      }
      cancel?.remove()
      delete button.__cancelExport
      showToast(message)
    }
    const timer = setTimeout(() => {
      try {
        if (new URLSearchParams(location.search).get('export') === 'error') throw new Error('export failed')
        const allLedger = button.dataset.exportCsv === 'all-ledger'
        const records = recordsForExport(button.dataset.exportCsv)
        if (!records.length) {
          if (value) value.textContent = '当前范围为空'
          finish('当前筛选没有可导出的账目，未生成文件')
          return
        }
        createCsvDownload(
          button,
          allLedger ? '我的全部收支.csv' : '当前筛选收支.csv',
          ledgerCsvRows(records)
        )
        if (value) value.textContent = '下载完成'
        finish('CSV 已导出')
      } catch (error) {
        if (value) value.textContent = '失败 · 可重试'
        finish('导出失败，当前筛选和页面状态已保留')
      }
    }, 750)
    button.__cancelExport = () => {
      clearTimeout(timer)
      if (value) value.textContent = '已取消 · 可重试'
      finish('导出已取消，没有生成文件')
    }
    cancel?.addEventListener('click', button.__cancelExport)
  }))
}

function updateDefaultOrder(type) {
  const rows = [...document.querySelectorAll('[data-default-table-body] tr')]
    .filter(row => row.children[0].textContent.trim() === type)
  rows.forEach((row, index) => { row.children[2].textContent = String(index + 1) })
}

function openDefaultEditor(row = null) {
  const sheet = document.querySelector('#default-item-sheet .sheet')
  if (!sheet) return
  sheet.querySelector('[data-default-type]').value = row?.children[0].textContent.trim() || '支出分类'
  sheet.querySelector('[data-default-name]').value = row?.children[1].textContent.trim() || ''
  sheet.querySelector('[data-default-save-error]').hidden = true
  sheet.__editingRow = row
  openOverlay('default-item-sheet')
}

function moveDefaultRow(row) {
  const type = row.children[0].textContent.trim()
  const siblings = [...row.parentElement.children]
  const previous = siblings.slice(0, siblings.indexOf(row)).reverse()
    .find(candidate => candidate.children[0].textContent.trim() === type)
  if (!previous) return showToast('当前项已是该类型第一项')
  row.parentElement.insertBefore(row, previous)
  updateDefaultOrder(type)
  appendAdminLog('调整默认字典排序', `${type} / ${row.children[1].textContent.trim()}`, '排序已更新，仅影响之后创建的用户')
  showToast('默认字典排序已更新')
}

function openDefaultActions(row) {
  const sheet = document.getElementById('default-actions-sheet')
  if (!sheet) return
  sheet.__defaultRow = row
  const type = row.children[0].textContent.trim()
  const name = row.children[1].textContent.trim()
  const disabled = row.querySelector('.tag')?.textContent.trim() === '已停用'
  sheet.querySelector('[data-default-action-name]').textContent = `${type} · ${name}`
  sheet.querySelector('[data-default-sheet-toggle-label]').textContent = disabled ? '恢复' : '停用'
  openOverlay('default-actions-sheet')
}

function bindDefaultRow(row) {
  if (row.dataset.defaultBound === 'true') return
  row.dataset.defaultBound = 'true'
  row.querySelector('[data-default-edit]')?.addEventListener('click', () => openDefaultEditor(row))
  row.querySelector('[data-default-toggle]')?.addEventListener('click', toggleDefaultState)
  row.querySelector('[data-default-move]')?.addEventListener('click', () => moveDefaultRow(row))
  const actionCell = row.lastElementChild
  if (actionCell && !actionCell.querySelector('[data-default-mobile-action]')) {
    const mobileAction = document.createElement('button')
    mobileAction.type = 'button'
    mobileAction.className = 'btn text default-mobile-action'
    mobileAction.dataset.defaultMobileAction = ''
    mobileAction.textContent = '更多'
    mobileAction.addEventListener('click', () => openDefaultActions(row))
    actionCell.append(mobileAction)
  }
}

function openAdminConfirm({ title, message, confirmText, onConfirm, sourceOverlay }) {
  const dialog = document.getElementById('admin-action-dialog')
  dialog.querySelector('[data-admin-confirm-title]').textContent = title
  dialog.querySelector('[data-admin-confirm-message]').textContent = message
  dialog.querySelector('[data-admin-confirm]').textContent = confirmText
  dialog.__confirmAction = onConfirm
  if (sourceOverlay) closeOverlay(sourceOverlay)
  openOverlay('admin-action-dialog')
}

function commitDefaultItem(sheet, type, name) {
  const editingRow = sheet.__editingRow
  if (editingRow) {
    const oldType = editingRow.children[0].textContent.trim()
    editingRow.children[0].textContent = type
    editingRow.children[1].textContent = name
    if (oldType !== type) {
      const body = editingRow.parentElement
      const lastSameType = [...body.children].filter(item => item !== editingRow && item.children[0].textContent.trim() === type).at(-1)
      if (lastSameType) body.insertBefore(editingRow, lastSameType.nextSibling)
      else body.appendChild(editingRow)
    }
    updateDefaultOrder(oldType)
    updateDefaultOrder(type)
  } else {
    const body = document.querySelector('[data-default-table-body]')
    const row = document.createElement('tr')
    row.innerHTML = '<td></td><td></td><td></td><td><span class="tag success">启用</span></td><td>新用户</td><td><div class="row-actions"><button data-default-move>上移</button><button data-default-edit>编辑</button><button data-default-toggle>停用</button></div></td>'
    row.children[0].textContent = type
    row.children[1].textContent = name
    const lastSameType = [...body.children].filter(item => item.children[0].textContent.trim() === type).at(-1)
    if (lastSameType) body.insertBefore(row, lastSameType.nextSibling)
    else body.appendChild(row)
    bindDefaultRow(row)
    updateDefaultOrder(type)
  }
  appendAdminLog('保存默认字典', `${type} / ${name}`, '默认项已保存，仅影响之后创建的用户')
  sheet.__editingRow = null
  closeOverlay(sheet.closest('.overlay'))
  showToast('默认字典项已保存，仅影响之后创建的用户')
}

function initAdminActions() {
  document.querySelectorAll('[data-default-table-body] tr').forEach(bindDefaultRow)
  document.querySelector('[data-default-add]')?.addEventListener('click', () => openDefaultEditor())
  document.querySelectorAll('[data-default-sheet-action]').forEach(button => button.addEventListener('click', () => {
    const actions = button.closest('.overlay')
    const row = actions.__defaultRow
    if (!row) return
    closeOverlay(actions)
    if (button.dataset.defaultSheetAction === 'move') moveDefaultRow(row)
    if (button.dataset.defaultSheetAction === 'edit') openDefaultEditor(row)
    if (button.dataset.defaultSheetAction === 'toggle') toggleDefaultRowState(row)
  }))
  document.querySelector('[data-default-save]')?.addEventListener('click', event => {
    const button = event.currentTarget
    const sheet = button.closest('.sheet')
    if (!validateEntry(sheet)) return
    const name = sheet.querySelector('[data-default-name]').value.trim()
    const type = sheet.querySelector('[data-default-type]').value
    const error = sheet.querySelector('[data-default-save-error]')
    error.hidden = true
    setButtonLoading(button, true, '保存中…')
    setTimeout(() => {
      setButtonLoading(button, false)
      const failOnce = new URLSearchParams(location.search).get('default') === 'error' && button.dataset.failureShown !== 'true'
      if (failOnce) {
        button.dataset.failureShown = 'true'
        error.hidden = false
        return
      }
      commitDefaultItem(sheet, type, name)
    }, 650)
  })
  document.querySelector('[data-admin-confirm]')?.addEventListener('click', event => {
    const dialog = event.currentTarget.closest('.overlay')
    const action = dialog.__confirmAction
    dialog.__confirmAction = null
    closeOverlay(dialog)
    action?.()
  })
  document.querySelectorAll('[data-reset-password]').forEach(button => button.addEventListener('click', () => {
    const actions = button.closest('.overlay')
    const row = button.closest('.overlay').__userRow
    openAdminConfirm({
      title: '确认重置密码？',
      message: `${row.dataset.username} 的全部旧会话将立即失效。`,
      confirmText: '确认重置',
      sourceOverlay: actions,
      onConfirm: () => {
        syncUserActionSheet(row)
        openOverlay('user-actions-sheet')
        const result = document.querySelector('[data-reset-result]')
        result.hidden = false
        result.textContent = '新临时密码：Q7mK4pV9xT2rN6zA（仅本次展示，24 小时有效）'
        appendAdminLog('重置密码', row.dataset.username, '旧会话已失效并生成一次性临时密码')
        showToast('旧会话已失效，重置动作已写入日志')
      }
    })
  }))
  document.querySelector('[data-user-status-action]')?.addEventListener('click', event => {
    const button = event.currentTarget
    const sheet = button.closest('.overlay')
    const row = sheet.__userRow
    const restoring = button.dataset.nextStatus === 'restore'
    openAdminConfirm({
      title: restoring ? '确认恢复用户？' : '确认停用用户？',
      message: restoring ? `${row.dataset.username} 将重新获得访问权限。` : `${row.dataset.username} 将立即失去访问权限，全部旧会话失效。`,
      confirmText: restoring ? '确认恢复' : '确认停用',
      sourceOverlay: sheet,
      onConfirm: () => {
        if (!restoring) row.dataset.previousStatus = row.querySelector('.tag').textContent.trim()
        const nextStatus = restoring ? row.dataset.previousStatus || '正常' : '停用'
        setUserStatus(row, nextStatus)
        appendAdminLog(restoring ? '恢复用户' : '停用用户', row.dataset.username, restoring ? '账号恢复访问权限' : '账号访问权限和旧会话已失效')
        updateUserFilter()
        showToast(restoring ? '用户已恢复，操作已写入日志' : '用户已停用，旧会话已失效，操作已写入日志')
      }
    })
  })
  document.querySelector('[data-user-delete]')?.addEventListener('click', event => {
    const actions = event.currentTarget.closest('.overlay')
    const row = actions.__userRow
    const dialog = document.getElementById('user-delete-dialog')
    dialog.__userRow = row
    dialog.querySelector('[data-user-delete-name]').textContent = row.dataset.username
    closeOverlay(actions)
    openOverlay('user-delete-dialog')
  })
  document.querySelector('[data-user-delete-confirm]')?.addEventListener('click', event => {
    const dialog = event.currentTarget.closest('.overlay')
    const row = dialog.__userRow
    if (!row) return
    setUserStatus(row, '注销处理中')
    appendAdminLog('注销用户', row.dataset.username, '访问权限已失效并进入可审计数据清理流程')
    updateUserFilter()
    closeOverlay(dialog)
    showToast('用户已进入注销处理，操作已写入日志')
  })
}

function toggleDefaultRowState(row) {
  const button = row.querySelector('[data-default-toggle]')
  const tag = row.querySelector('.tag')
  const disabling = tag.textContent.trim() !== '已停用'
  tag.textContent = disabling ? '已停用' : '启用'
  tag.classList.toggle('success', !disabling)
  button.textContent = disabling ? '恢复' : '停用'
  appendAdminLog(disabling ? '停用默认字典' : '恢复默认字典', `${row.children[0].textContent.trim()} / ${row.children[1].textContent.trim()}`, '状态已更新，仅影响之后创建的用户')
  showToast('默认字典状态已更新，仅影响之后创建的用户')
}

function toggleDefaultState(event) {
  toggleDefaultRowState(event.currentTarget.closest('tr'))
}

function initFilters() {
  document.querySelectorAll('[data-apply-filters]').forEach(button => button.addEventListener('click', () => {
    const overlay = button.closest('.overlay')
    const summary = document.querySelector('[data-filter-summary-text]')
    if (overlay.id === 'filter-sheet') {
      if (!setRangeValidation(overlay.querySelector('[data-report-range]'), overlay.querySelector('[data-report-range-start]'), overlay.querySelector('[data-report-range-end]'))) return
      const filterState = readReportFilterState()
      if (summary) summary.textContent = filterState.summary
      const reportScope = filterState.scope === 'all' ? 'overview' : filterState.scope
      document.querySelector('[data-report-view]')?.__renderScope?.(reportScope)
    } else if (overlay.id === 'detail-filter') {
      if (!setRangeValidation(overlay.querySelector('[data-detail-range]'), overlay.querySelector('[data-detail-range-start]'), overlay.querySelector('[data-detail-range-end]'))) return
      applyDetailFilters(readDetailFilterState())
    } else {
      const labels = getActiveFormControls(overlay).filter(control => control.tagName === 'SELECT').map(select => select.selectedOptions[0]?.textContent).filter(Boolean)
      if (summary) summary.textContent = labels.join(' · ')
    }
    closeOverlay(overlay)
    showToast('筛选已应用，页面数据已刷新')
  }))
  document.querySelectorAll('[data-clear-filters]').forEach(button => button.addEventListener('click', () => {
    const overlay = button.closest('.overlay')
    overlay.querySelectorAll('select').forEach(select => { select.selectedIndex = 0 })
    overlay.querySelectorAll('input').forEach(input => { input.value = '' })
    const preferences = getPreferences()
    if (overlay.id === 'filter-sheet') {
      const range = overlay.querySelector('[data-report-range]')
      if (range) restoreRangeControl(range, overlay.querySelector('[data-report-range-start]'), overlay.querySelector('[data-report-range-end]'), reportRangeValues[preferences.reportRange])
      const search = document.querySelector('[data-report-global-search]')
      if (search) search.value = ''
    }
    if (overlay.id === 'detail-filter') {
      const range = overlay.querySelector('[data-detail-range]')
      if (range) restoreRangeControl(range, overlay.querySelector('[data-detail-range-start]'), overlay.querySelector('[data-detail-range-end]'), preferences.detailRange)
      const search = document.querySelector('[data-detail-global-search]')
      if (search) search.value = ''
      document.querySelector('[data-page-content]')?.setAttribute('data-applied-detail-filter', '{}')
    }
    overlay.querySelector('[data-report-filter-scope]')?.dispatchEvent(new Event('change'))
    const summary = document.querySelector('[data-filter-summary-text]')
    const labels = getActiveFormControls(overlay)
      .filter(control => control.tagName === 'SELECT')
      .map(select => select.selectedOptions[0]?.textContent)
      .filter(Boolean)
    if (summary) summary.textContent = labels.join(' · ')
    if (overlay.id === 'filter-sheet') document.querySelector('[data-report-view]')?.__renderScope?.('overview')
    if (overlay.id === 'detail-filter') applyDetailFilters(readDetailFilterState())
    closeOverlay(overlay)
    showToast('已恢复默认筛选')
  }))
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme()
  mountPwaInstallSheet()
  initIcons()
  renderFundingControls()
  initFormAccessibility()
  initOverlays()
  initPwaInstall()
  initCommonActions()
  initPageState()
  initMoneyForms()
  initLogin()
  initEntryTypes()
  initDailyTemplates()
  initEntrySubmit()
  initReportFilters()
  initReports()
  initReportDrill()
  initBillDetails()
  initAdmin()
  initLogFilters()
  initDictionaries()
  initFilters()
  initAdminActions()
  initProfilePreferences()
  initProfileActions()
  initExports()
})
