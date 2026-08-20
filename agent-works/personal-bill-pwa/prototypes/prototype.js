const icons = {
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10m-7 6h4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18 12a6 6 0 0 0-10.2-4.3L4 12m2 0a6 6 0 0 0 10.2 4.3L20 12"/></svg>'
}

const preferenceStorageKey = 'bill-prototype-preferences'
const preferenceSessionKey = 'bill-prototype-preference-session'
const fundingDictionaryStorageKey = 'bill-prototype-funding-dictionary'
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
  detailRange: '本月',
  reportRange: '本月',
  entryType: 'expense',
  theme: 'system'
})
const preferenceOptions = {
  detailRange: ['本月', '上月', '今年'],
  reportRange: ['本月', '上月', '今年'],
  entryType: ['expense', 'income'],
  theme: ['system', 'light', 'dark']
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
  本月: '2026-08-01/2026-08-31',
  上月: '2026-07-01/2026-07-31',
  今年: '2026-01-01/2026-12-31'
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0A0B0D' : '#FFFFFF')
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
    const manage = document.createElement('button')
    manage.type = 'button'
    manage.className = 'chip'
    manage.dataset.open = 'funding-sheet'
    manage.textContent = fundingManagementLabel
    manage.setAttribute('aria-label', fundingManagementLabel)
    group.replaceChildren(...enabledChannels.map(channel => createFundingChip(channel, 'picker')), manage)
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
  if (count) count.textContent = `${readFundingDictionary().length} 项 · 管理`
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
  if (state === 'permission') content.hidden = true
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
  const target = state === 'permission' || !region ? content.parentElement : region
  const block = document.createElement('section')
  block.className = `state region-state ${state === 'error' || state === 'permission' ? 'error' : ''}`
  const href = state === 'empty' && regionName === 'report' ? 'expense-entry.html' : state === 'permission' ? 'login.html' : `${location.pathname.split('/').pop()}`
  block.innerHTML = `<div class="state-stack"><div><strong>${selected[0]}</strong><span>${selected[1]}</span></div>${selected[2] ? `<a class="btn ${state === 'error' ? 'primary' : ''}" href="${href}">${selected[2]}</a>` : '<div class="skeleton-line" aria-hidden="true"></div>'}</div>`
  if (state === 'loading' || state === 'empty') [...target.children].forEach(child => { child.hidden = true })
  target.prepend(block)
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
      const message = button.dataset.saveEntry === 'continue'
        ? `已保存${type}，继续记下一笔`
        : button.dataset.saveEntry === 'adjustment' ? '调整已保存，净支出与报表已刷新' : `${type}已保存，明细与报表已刷新`
      showToast(message)
      if (button.dataset.saveEntry === 'continue') {
        const fields = type === '收入' ? ['[data-income-name]', '[data-payer]', '[data-income-amount]'] : ['[data-product]']
        fields.forEach(selector => { const input = scope.querySelector(selector); if (input) input.value = '' })
      }
      if (button.closest('#unlinked-adjustment-sheet')) {
        const name = scope.querySelector('input:not([type="datetime-local"])')?.value.trim() || '未关联调整'
        const amount = scope.querySelector('[data-scale="2"]')?.value || '0.00'
        document.querySelector('[data-ledger-list]')?.append(createAdjustmentRow({ id: `adjustment-${Date.now()}`, name, amount }))
        updateLedgerCounts()
      }
      if (button.closest('.overlay')) closeOverlay(button.closest('.overlay'))
    }, 1200)
  }))
}

function updateLedgerCounts() {
  const active = document.querySelectorAll('[data-view="active"] [data-ledger-item]').length
  const trash = document.querySelectorAll('[data-view="trash"] [data-ledger-item]').length
  const activeButton = document.querySelector('[data-bill-tab="active"]')
  const trashButton = document.querySelector('[data-bill-tab="trash"]')
  if (activeButton) activeButton.textContent = `有效账目 ${active}`
  if (trashButton) trashButton.textContent = `回收站 ${trash}`
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
    const copy = shell.querySelector('[data-copy-entry]')
    if (primary) primary.textContent = safeType === 'income' ? '保存收入' : '保存支出'
    if (copy) copy.textContent = safeType === 'income' ? '复制上一笔收入' : '复制上一笔支出'
    updatePreferences({ entryType: safeType })
  }
  shell.querySelectorAll('[data-entry-type]').forEach(button => button.addEventListener('click', () => setType(button.dataset.entryType)))
  shell.querySelector('[data-copy-entry]')?.addEventListener('click', () => {
    const type = shell.querySelector('[data-entry-type].active')?.dataset.entryType === 'income' ? '收入' : '支出'
    showToast(`已复制上一笔${type}，业务时间更新为现在`)
  })
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

function renderReportRangeCopy(rangeValue, scope) {
  const label = getReportFilterLabel('range', rangeValue) || '本月'
  const dateCaptions = {
    '2026-08-01/2026-08-31': '本月 · 2026年8月',
    '2026-07-01/2026-07-31': '上月 · 2026年7月',
    '2026-01-01/2026-12-31': '今年 · 2026年'
  }
  const dateCaption = document.querySelector('[data-report-date-caption]')
  if (dateCaption) dateCaption.textContent = dateCaptions[rangeValue] || `${label} · 自定义范围`
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
    funding: reportFilter.values.funding
  }
  const summary = [
    getReportFilterLabel('range', values.range),
    reportScopeLabels[scope],
    getReportFilterLabel('funding', values.funding)
  ].filter(Boolean).join(' · ')
  return { scope: requestedFilterScope, range: values.range, summary, values }
}

function readReportFilterState() {
  const sheet = document.getElementById('filter-sheet')
  if (!sheet) return { scope: 'all', range: '2026-08-01/2026-08-31', summary: '本月 · 全部账目', values: {} }
  const controls = getActiveFormControls(sheet).filter(control => control.dataset.filterKey)
  const values = Object.fromEntries(controls.map(control => [control.dataset.filterKey, control.value]))
  const labels = controls.map(control => control.tagName === 'SELECT' ? control.selectedOptions[0]?.textContent : control.value.trim()).filter(Boolean)
  return { scope: values.scope || 'all', range: values.range || '2026-08-01/2026-08-31', summary: labels.join(' · '), values }
}

function restoreReportFilterState(values = {}) {
  document.querySelectorAll('#filter-sheet [data-filter-key]').forEach(control => {
    control.value = control.tagName === 'SELECT' ? control.options[0].value : ''
  })
  Object.entries(values).forEach(([key, value]) => {
    const control = document.querySelector(`[data-filter-key="${key}"]`)
    if (control) control.value = value
  })
  document.querySelector('[data-report-filter-scope]')?.dispatchEvent(new Event('change'))
}

function initReports() {
  const host = document.querySelector('[data-report-view]')
  if (!host) return
  let scope = 'overview'
  const render = key => {
    const view = reportViews[key]
    if (!view) return
    host.classList.toggle('report-expense', scope === 'expense')
    host.classList.toggle('report-income', scope === 'income')
    host.querySelector('[data-report-title]').textContent = view[0]
    host.querySelector('[data-report-caption]').textContent = view[1]
    const chart = host.querySelector('[data-report-chart]')
    chart.innerHTML = view[2].map((item, index) => {
      const [label, value, height] = item.split('|')
      const seriesClass = scope === 'overview' && label.includes('支出') ? ' expense-series' : scope === 'overview' && label.includes('收入') ? ' income-series' : ''
      return `<button type="button" class="bar${index === 0 ? ' active' : ''}${seriesClass}" style="--h:${height}%" data-dimension="${key}" data-label="${label}" data-value="${label}" data-metric="${value}" data-scope="${scope}" aria-label="${label}，${value}"><span>${label}</span></button>`
    }).join('')
    initReportDrill(chart)
    const ranking = document.querySelector('[data-report-ranking]')
    if (ranking) ranking.innerHTML = view[2].slice(0, 3).map((item, index) => {
      const [label, value] = item.split('|')
      const sign = scope === 'expense' ? '−' : scope === 'income' ? '+' : ''
      return `<button class="rank-row" data-drill data-scope="${scope}" data-dimension="${key}" data-value="${label}" data-metric="${value}"><span class="rank-index">0${index + 1}</span><span>${label}</span><strong class="rank-value ${scope === 'expense' ? 'expense-amount' : scope === 'income' ? 'income-amount' : ''}">${sign}${isNaN(Number(value)) ? value : `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`}</strong></button>`
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
    const dimensions = document.querySelector('[data-report-dimensions]')
    const validDimension = reportScopes[scope].some(item => item.key === selectedDimension) ? selectedDimension : reportScopes[scope][0].key
    dimensions.innerHTML = reportScopes[scope].map(item => `<button class="chip${item.key === validDimension ? ' active' : ''}" data-report-dimension="${item.key}" aria-pressed="${item.key === validDimension}">${item.label}</button>`).join('')
    dimensions.querySelectorAll('[data-report-dimension]').forEach(button => button.addEventListener('click', () => {
      dimensions.querySelectorAll('[data-report-dimension]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)) })
      render(button.dataset.reportDimension)
    }))
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
    if (rangeSelect) rangeSelect.value = preferredRange
  }
  const initialScope = reportScopes[restored?.scope] ? restored.scope : sessionStorage.getItem('bill-report-scope') || 'overview'
  renderScope(initialScope, restored?.dimension)
  if (restored) {
    requestAnimationFrame(() => window.scrollTo(0, Number(restored.scrollY) || 0))
  }
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

function bindAdjustmentRow(row) {
  bindOverlayTrigger(row)
  row.addEventListener('click', () => {
    const detail = document.getElementById('adjustment-detail')
    if (!detail) return
    detail.__adjustmentRow = row
    const name = row.querySelector('.item-title')?.textContent.trim() || '当前调整'
    detail.querySelector('[data-adjustment-detail-name]').textContent = name
    const pending = row.dataset.adjustmentState === 'pending'
    detail.querySelectorAll('[data-adjustment-action="link"], [data-adjustment-action="income"]').forEach(button => { button.hidden = !pending })
  })
}

function createAdjustmentRow({ id, name, amount, state = 'pending' }) {
  const row = document.createElement('button')
  row.className = 'list-item'
  row.dataset.ledgerItem = 'adjustment'
  row.dataset.adjustmentId = id
  row.dataset.adjustmentState = state
  row.dataset.open = 'adjustment-detail'
  const description = document.createElement('div')
  const title = document.createElement('div')
  title.className = 'item-title'
  const tag = document.createElement('span')
  tag.className = 'tag warning'
  tag.textContent = '待归类'
  title.append(tag, ` ${name}`)
  const meta = document.createElement('div')
  meta.className = 'item-meta'
  meta.textContent = '尚未关联原支出 · 不进入正式报表'
  const amountElement = document.createElement('div')
  amountElement.className = 'item-amount'
  amountElement.textContent = `¥${amount}`
  description.append(title, meta)
  row.append(description, amountElement)
  bindAdjustmentRow(row)
  return row
}

function initBillDetails() {
  const context = document.querySelector('[data-drill-context]')
  const params = new URLSearchParams(location.search)
  const detailPreferences = getPreferences()
  const detailRange = document.querySelector('[data-detail-range]')
  if (detailRange) detailRange.value = detailPreferences.detailRange
  const detailSummary = document.querySelector('[data-detail-filter-summary]')
  if (detailSummary) detailSummary.textContent = `${detailPreferences.detailRange} · 全部账目`
  if (context && params.get('source') === 'reports') {
    context.hidden = false
    const reportScope = reportScopes[params.get('scope')] ? params.get('scope') : 'overview'
    const scopeLabel = reportScopeLabels[reportScope]
    const dimensionLabel = getReportDimensionLabel(reportScope, params.get('dimension'))
    context.querySelector('span').textContent = `来自${scopeLabel}报表 · ${dimensionLabel}：${params.get('value') || '全部'} · ${params.get('range') || ''}`
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
  }))
  document.querySelectorAll('[data-ledger-item="adjustment"][data-open="adjustment-detail"]').forEach(bindAdjustmentRow)
  document.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', () => {
    const row = button.closest('.list-item')
    const activeList = document.querySelector('[data-ledger-list]')
    const billId = row?.dataset.billId
    row?.querySelector('.row-actions')?.remove()
    if (row) activeList.append(row)
    if (billId) {
      const adjustment = document.querySelector(`[data-original-id="${billId}"]`)
      if (adjustment) {
        adjustment.dataset.adjustmentState = 'active'
        const tag = adjustment.querySelector('.tag')
        tag.textContent = '报销'
        tag.className = 'tag adjustment'
        adjustment.querySelector('.item-meta').textContent = '原支出已恢复 · 调整重新生效并计入净支出'
        adjustment.dataset.open = 'adjustment-detail'
        adjustment.setAttribute('role', 'button')
        adjustment.tabIndex = 0
        bindAdjustmentRow(adjustment)
        activeList.append(adjustment)
      }
    }
    updateLedgerCounts()
    showToast(billId ? '原支出与关联调整已恢复并重新计入报表' : '账单已恢复，并重新计入报表')
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
    if (action === 'revoke') row.remove()
    if (action === 'link') {
      row.dataset.adjustmentState = 'active'
      const tag = row.querySelector('.tag')
      tag.textContent = '退款'
      tag.className = 'tag adjustment'
      row.querySelector('.item-meta').textContent = '刚刚 · 已关联支出“早餐包” · 已计入净支出'
    }
    if (action === 'income') {
      row.dataset.ledgerItem = 'income'
      delete row.dataset.adjustmentId
      delete row.dataset.adjustmentState
      row.removeAttribute('data-open')
      const tag = row.querySelector('.tag')
      tag.textContent = '收入'
      tag.className = 'tag income'
      row.querySelector('.item-meta').textContent = '刚刚 · 由待归类调整改记 · 其他收入'
      row.querySelector('.item-amount').textContent = `+${row.querySelector('.item-amount').textContent}`
    }
    closeOverlay(detail)
    updateLedgerCounts()
    showToast(action === 'revoke' ? '当前调整已撤销，相关报表已刷新' : action === 'link' ? '当前调整已关联并计入净支出' : '当前调整已改记为收入')
  }))
  document.querySelectorAll('[data-purge-confirm]').forEach(button => button.addEventListener('click', () => {
    const overlay = button.closest('.overlay')
    const row = overlay?.__sourceTrigger?.closest('.list-item')
    const billId = row?.dataset.billId
    if (billId) document.querySelector(`[data-original-id="${billId}"]`)?.remove()
    row?.remove()
    closeOverlay(overlay)
    updateLedgerCounts()
    showToast(button.dataset.purgeConfirm)
  }))
  document.querySelectorAll('[data-ledger-type]').forEach(button => button.addEventListener('click', () => {
    const type = button.dataset.ledgerType
    document.querySelectorAll('[data-ledger-type]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)) })
    let visible = 0
    document.querySelectorAll('[data-ledger-item]').forEach(item => { item.hidden = type !== 'all' && item.dataset.ledgerItem !== type; if (!item.hidden) visible += 1 })
    const empty = document.querySelector('[data-ledger-empty]')
    if (empty) empty.hidden = visible > 0
  }))
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
  if (!select) return
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

function renderProfilePreferences() {
  const state = getPreferenceState()
  const preferences = state.values
  const entryTypeLabels = { expense: '支出', income: '收入' }
  const themeLabels = { system: '跟随系统', light: '白天', dark: '夜晚' }
  document.querySelectorAll('[data-preference-value]').forEach(value => {
    const key = value.dataset.preferenceValue
    const suffix = state.fields[key].status === 'pending' ? '保存中' : state.fields[key].status === 'error' ? '待重试' : key === 'entryType' ? '自动保存' : '修改'
    value.textContent = key === 'entryType'
      ? `${entryTypeLabels[preferences.entryType]} · ${suffix}`
      : `${key === 'fundingChannel' ? getFundingChannelName(preferences[key]) : preferences[key]} · ${suffix}`
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
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  clearCsvDownload(button)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  link.download = filename
  link.className = 'btn text'
  link.dataset.csvDownload = ''
  link.textContent = '下载 CSV'
  button.insertAdjacentElement('afterend', link)
}

function initExports() {
  document.querySelectorAll('[data-export-csv]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.exportState === 'running') return
    clearCsvDownload(button)
    button.dataset.exportState = 'running'
    const value = button.querySelector('.setting-value')
    if (value) {
      button.disabled = true
      value.textContent = '准备中…'
    } else {
      setButtonLoading(button, true, '准备导出…')
    }
    const cancel = document.createElement('button')
    cancel.className = 'btn text'
    cancel.type = 'button'
    cancel.textContent = '取消导出'
    button.insertAdjacentElement('afterend', cancel)
    const finish = message => {
      button.dataset.exportState = 'idle'
      button.disabled = false
      if (!value) setButtonLoading(button, false)
      cancel.remove()
      showToast(message)
    }
    const timer = setTimeout(() => {
      try {
        if (new URLSearchParams(location.search).get('export') === 'error') throw new Error('export failed')
        const allLedger = button.dataset.exportCsv === 'all-ledger'
        createCsvDownload(
          button,
          allLedger ? '我的全部收支.csv' : '当前筛选收支.csv',
          [['类型', '名称', '金额', '业务时间'], ['收入', '8 月工资', '8500.00', '2026-08-13 09:00'], ['支出', '早餐包', '28.00', '2026-08-13 08:12']]
        )
        if (value) value.textContent = '下载完成'
        finish('CSV 已生成，请点击“下载 CSV”保存文件')
      } catch (error) {
        if (value) value.textContent = '失败 · 可重试'
        finish('导出失败，当前筛选和页面状态已保留')
      }
    }, 750)
    cancel.addEventListener('click', () => {
      clearTimeout(timer)
      if (value) value.textContent = '已取消 · 可重试'
      finish('导出已取消，没有生成文件')
    })
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

function bindDefaultRow(row) {
  if (row.dataset.defaultBound === 'true') return
  row.dataset.defaultBound = 'true'
  row.querySelector('[data-default-edit]')?.addEventListener('click', () => openDefaultEditor(row))
  row.querySelector('[data-default-toggle]')?.addEventListener('click', toggleDefaultState)
  row.querySelector('[data-default-move]')?.addEventListener('click', () => {
    const type = row.children[0].textContent.trim()
    const siblings = [...row.parentElement.children]
    const previous = siblings.slice(0, siblings.indexOf(row)).reverse()
      .find(candidate => candidate.children[0].textContent.trim() === type)
    if (!previous) return showToast('当前项已是该类型第一项')
    row.parentElement.insertBefore(row, previous)
    updateDefaultOrder(type)
    appendAdminLog('调整默认字典排序', `${type} / ${row.children[1].textContent.trim()}`, '排序已更新，仅影响之后创建的用户')
    showToast('默认字典排序已更新')
  })
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

function toggleDefaultState(event) {
  const button = event.currentTarget
  button.textContent = button.textContent === '停用' ? '恢复' : '停用'
  const tag = button.closest('tr').querySelector('.tag')
  tag.textContent = button.textContent === '恢复' ? '已停用' : '启用'
  tag.classList.toggle('success', button.textContent !== '恢复')
  appendAdminLog(button.textContent === '恢复' ? '停用默认字典' : '恢复默认字典', `${button.closest('tr').children[0].textContent.trim()} / ${button.closest('tr').children[1].textContent.trim()}`, '状态已更新，仅影响之后创建的用户')
  showToast('默认字典状态已更新，仅影响之后创建的用户')
}

function initFilters() {
  document.querySelectorAll('[data-apply-filters]').forEach(button => button.addEventListener('click', () => {
    const overlay = button.closest('.overlay')
    const summary = document.querySelector('[data-filter-summary-text]')
    if (overlay.id === 'filter-sheet') {
      const filterState = readReportFilterState()
      if (summary) summary.textContent = filterState.summary
      const reportScope = filterState.scope === 'all' ? 'overview' : filterState.scope
      document.querySelector('[data-report-view]')?.__renderScope?.(reportScope)
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
      if (range) range.value = reportRangeValues[preferences.reportRange]
    }
    if (overlay.id === 'detail-filter') {
      const range = overlay.querySelector('[data-detail-range]')
      if (range) range.value = preferences.detailRange
    }
    overlay.querySelector('[data-report-filter-scope]')?.dispatchEvent(new Event('change'))
    const summary = document.querySelector('[data-filter-summary-text]')
    const labels = getActiveFormControls(overlay)
      .filter(control => control.tagName === 'SELECT')
      .map(select => select.selectedOptions[0]?.textContent)
      .filter(Boolean)
    if (summary) summary.textContent = labels.join(' · ')
    if (overlay.id === 'filter-sheet') document.querySelector('[data-report-view]')?.__renderScope?.('overview')
    closeOverlay(overlay)
    showToast('已恢复默认筛选')
  }))
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme()
  initIcons()
  renderFundingControls()
  initOverlays()
  initCommonActions()
  initPageState()
  initMoneyForms()
  initLogin()
  initEntryTypes()
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
