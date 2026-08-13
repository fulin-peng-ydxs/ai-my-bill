const icons = {
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10m-7 6h4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18 12a6 6 0 0 0-10.2-4.3L4 12m2 0a6 6 0 0 0 10.2 4.3L20 12"/></svg>'
}

function resolveTheme(mode) {
  return mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode
}

function applyTheme(mode) {
  const safeMode = ['system', 'light', 'dark'].includes(mode) ? mode : 'system'
  const resolved = resolveTheme(safeMode)
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themeMode = safeMode
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#11131A' : '#F6F7FB')
  document.querySelectorAll('[data-theme-mode]').forEach(button => {
    const active = button.dataset.themeMode === safeMode
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  localStorage.setItem('bill-prototype-theme', safeMode)
}

function initTheme() {
  applyTheme(localStorage.getItem('bill-prototype-theme') || 'system')
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

function initOverlays() {
  document.querySelectorAll('[data-open]').forEach(trigger => trigger.addEventListener('click', () => {
    const overlay = document.getElementById(trigger.dataset.open)
    if (overlay) overlay.__sourceTrigger = trigger
    const sourceOverlay = trigger.closest('.overlay')
    if (sourceOverlay && sourceOverlay !== overlay) closeOverlay(sourceOverlay)
    openOverlay(trigger.dataset.open)
  }))
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

function initCommonActions() {
  document.querySelectorAll('[data-toast]').forEach(trigger => trigger.addEventListener('click', () => showToast(trigger.dataset.toast)))
  document.querySelectorAll('[data-theme-mode]').forEach(button => button.addEventListener('click', () => applyTheme(button.dataset.themeMode)))
  document.querySelectorAll('[data-chip-group]').forEach(group => {
    group.querySelectorAll('.chip:not([data-open])').forEach(chip => chip.addEventListener('click', () => {
      group.querySelectorAll('.chip').forEach(item => {
        item.classList.toggle('active', item === chip)
        item.setAttribute('aria-pressed', String(item === chip))
      })
    }))
  })
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
    const invalid = !input.value.trim()
      || (numeric && !decimalPattern.test(input.value.trim()))
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
      if (button.closest('.overlay')) closeOverlay(button.closest('.overlay'))
    }, 1200)
  }))
}

function initEntryTypes() {
  const shell = document.querySelector('[data-entry-shell]')
  if (!shell) return
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
    localStorage.setItem('bill-prototype-entry-type', safeType)
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
  setType(localStorage.getItem('bill-prototype-entry-type') || 'expense')
  updateIncome()
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

function initReports() {
  const host = document.querySelector('[data-report-view]')
  if (!host) return
  let scope = 'overview'
  const render = key => {
    const view = reportViews[key]
    if (!view) return
    host.classList.toggle('report-expense', scope === 'expense')
    host.querySelector('[data-report-title]').textContent = view[0]
    host.querySelector('[data-report-caption]').textContent = view[1]
    const chart = host.querySelector('[data-report-chart]')
    chart.innerHTML = view[2].map((item, index) => {
      const [label, value, height] = item.split('|')
      const seriesClass = scope === 'overview' && label.includes('支出') ? ' expense-series' : ''
      return `<button type="button" class="bar${index === 0 ? ' active' : ''}${seriesClass}" style="--h:${height}%" data-dimension="${key}" data-label="${label}" data-value="${label}" data-metric="${value}" data-scope="${scope}" aria-label="${label}，${value}"><span>${label}</span></button>`
    }).join('')
    initReportDrill(chart)
    const ranking = document.querySelector('[data-report-ranking]')
    const rankingTitle = document.querySelector('[data-ranking-title]')
    if (rankingTitle) rankingTitle.textContent = scope === 'income' ? '收入排行' : scope === 'expense' ? '支出排行' : '本月构成'
    if (ranking) ranking.innerHTML = view[2].slice(0, 3).map((item, index) => {
      const [label, value] = item.split('|')
      const sign = scope === 'expense' ? '−' : scope === 'income' ? '+' : ''
      return `<button class="rank-row" data-drill data-scope="${scope}" data-dimension="${key}" data-value="${label}" data-metric="${value}"><span class="rank-index">0${index + 1}</span><span>${label}</span><strong class="rank-value ${scope === 'expense' ? 'expense-amount' : scope === 'income' ? 'income-amount' : ''}">${sign}${isNaN(Number(value)) ? value : `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`}</strong></button>`
    }).join('')
    initReportDrill(ranking || document)
  }
  const renderScope = (nextScope, selectedDimension) => {
    scope = nextScope
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
  document.querySelectorAll('[data-report-scope]').forEach(button => button.addEventListener('click', () => renderScope(button.dataset.reportScope)))
  const params = new URLSearchParams(location.search)
  let restored = null
  try { restored = JSON.parse(params.get('restore') || 'null') } catch (error) { restored = null }
  const initialScope = reportScopes[restored?.scope] ? restored.scope : sessionStorage.getItem('bill-report-scope') || 'overview'
  renderScope(initialScope, restored?.dimension)
  if (restored) {
    const summary = document.querySelector('[data-filter-summary-text]')
    if (summary && typeof restored.filters === 'string') summary.textContent = restored.filters
    if (Array.isArray(restored.filterValues)) {
      document.querySelectorAll('#filter-sheet input, #filter-sheet select').forEach((control, index) => {
        if (restored.filterValues[index] !== undefined) control.value = restored.filterValues[index]
      })
      document.querySelector('[data-report-filter-scope]')?.dispatchEvent(new Event('change'))
    }
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
    const scope = item.dataset.scope || document.querySelector('[data-report-scope].active')?.dataset.reportScope || 'overview'
    const filterControls = [...document.querySelectorAll('#filter-sheet input, #filter-sheet select')]
    const filters = document.querySelector('[data-filter-summary-text]')?.textContent || '本月 · 全部账目'
    const context = { scope, dimension, value, range: '2026-08-01/2026-08-31', filters, filterValues: filterControls.map(control => control.value), scrollY: window.scrollY }
    sessionStorage.setItem('bill-report-return', JSON.stringify(context))
    location.href = `bill-details.html?source=reports&scope=${encodeURIComponent(scope)}&dimension=${encodeURIComponent(dimension)}&value=${encodeURIComponent(value)}&range=${encodeURIComponent(context.range)}&filters=${encodeURIComponent(filters)}`
    })
  })
}

function initBillDetails() {
  const context = document.querySelector('[data-drill-context]')
  const params = new URLSearchParams(location.search)
  if (context && params.get('source') === 'reports') {
    context.hidden = false
    context.querySelector('span').textContent = `来自${params.get('scope') || '全部'}报表 · ${params.get('dimension') || '筛选'}：${params.get('value') || '全部'} · ${params.get('range') || ''}`
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
  document.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', () => {
    button.closest('.list-item')?.remove()
    showToast('账单已恢复，并重新计入报表')
  }))
  const linkedTrash = [...document.querySelectorAll('[data-view="trash"] [data-ledger-item="expense"]')].find(item => item.textContent.includes('旧雨伞'))
  if (linkedTrash) {
    const meta = linkedTrash.querySelector('.item-meta')
    if (meta) meta.textContent = '8月3日移入 · 关联调整 1 条已冻结 · 不参与报表'
    const purge = linkedTrash.querySelector('[data-open="purge-dialog"]')
    if (purge) purge.dataset.open = 'purge-linked-dialog'
  }
  document.querySelectorAll('[data-revoke-adjustment]').forEach(button => button.addEventListener('click', () => {
    const row = [...document.querySelectorAll('[data-ledger-item="adjustment"]')].find(item => item.textContent.includes('早餐包部分退款'))
    row?.remove()
    closeOverlay(button.closest('.overlay'))
    showToast('调整已撤销，原支出净额与报表已刷新')
  }))
  document.querySelectorAll('[data-purge-confirm]').forEach(button => button.addEventListener('click', () => {
    const overlay = button.closest('.overlay')
    overlay?.__sourceTrigger?.closest('.list-item')?.remove()
    closeOverlay(overlay)
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
}

function initAdmin() {
  const switchPanel = key => {
    document.querySelectorAll('[data-admin-panel]').forEach(panel => { panel.hidden = panel.dataset.adminPanel !== key })
    document.querySelectorAll('[data-admin-nav]').forEach(button => button.classList.toggle('active', button.dataset.adminNav === key))
    closeOverlay(document.getElementById('admin-nav-sheet'))
  }
  document.querySelectorAll('[data-admin-nav]').forEach(button => button.addEventListener('click', () => switchPanel(button.dataset.adminNav)))
  document.querySelectorAll('[data-create-user]').forEach(button => button.addEventListener('click', () => {
    const dialog = button.closest('.dialog')
    if (!validateEntry(dialog)) return
    button.disabled = true
    button.textContent = '创建中…'
    setTimeout(() => {
      button.disabled = false
      button.textContent = '创建用户'
      closeOverlay(button.closest('.overlay'))
      showToast('用户已创建；临时密码：A7kP9mQ2xR4tV8zN（仅本次展示）')
    }, 350)
  }))
}

function initDictionaries() {
  const title = document.querySelector('[data-dictionary-title]')
  const list = document.querySelector('[data-dictionary-list]')
  let currentName = ''
  const renderList = name => {
    list.innerHTML = `<div class="list-item" data-dictionary-row><div><input class="control" value="${name}示例一" aria-label="${name}名称"><div class="item-meta">历史引用保留</div></div><div class="row-actions"><button data-dictionary-move>上移</button><button data-dictionary-toggle>停用</button></div></div><div class="list-item" data-dictionary-row data-disabled="true"><div><input class="control" value="${name}示例二" aria-label="${name}名称"><div class="item-meta">已停用项不进入新填报</div></div><div class="row-actions"><button data-dictionary-move>上移</button><button data-dictionary-toggle>恢复</button></div></div>`
    list.querySelectorAll('input').forEach(input => input.addEventListener('change', () => showToast(`${name}已改名并刷新引用展示`)))
    list.querySelectorAll('[data-dictionary-move]').forEach(button => button.addEventListener('click', () => {
      const row = button.closest('[data-dictionary-row]')
      if (row.previousElementSibling) list.insertBefore(row, row.previousElementSibling)
      showToast(`${name}排序已更新`)
    }))
    list.querySelectorAll('[data-dictionary-toggle]').forEach(button => button.addEventListener('click', () => {
      const row = button.closest('[data-dictionary-row]')
      const disabled = row.dataset.disabled === 'true'
      row.dataset.disabled = String(!disabled)
      button.textContent = disabled ? '停用' : '恢复'
      showToast(`${name}${disabled ? '已恢复' : '已停用'}`)
    }))
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
    const row = document.createElement('div')
    row.className = 'list-item'
    const content = document.createElement('div')
    const itemTitle = document.createElement('div')
    itemTitle.className = 'item-title'
    itemTitle.textContent = value
    const meta = document.createElement('div')
    meta.className = 'item-meta'
    meta.textContent = '刚刚新增 · 启用'
    const status = document.createElement('span')
    status.className = 'tag success'
    status.textContent = '启用'
    content.append(itemTitle, meta)
    row.append(content, status)
    list.prepend(row)
    document.querySelector('[data-dictionary-new]').value = ''
    showToast(`${currentName}“${value}”已新增`)
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

function initProfileActions() {
  document.querySelector('[data-cycle-report-range]')?.addEventListener('click', event => {
    const value = event.currentTarget.querySelector('.setting-value')
    const ranges = ['本月', '上月', '今年']
    value.textContent = `${ranges[(ranges.indexOf(value.textContent.split(' · ')[0]) + 1) % ranges.length]} · 已保存`
    showToast('报表默认范围已更新')
  })
  document.querySelector('[data-export-profile]')?.addEventListener('click', event => {
    const value = event.currentTarget.querySelector('.setting-value')
    value.textContent = '准备中…'
    setTimeout(() => { value.textContent = 'CSV 已生成'; showToast('个人收支数据已生成') }, 600)
  })
  document.querySelector('[data-password-save]')?.addEventListener('click', event => {
    const sheet = event.currentTarget.closest('.sheet')
    if (!validateEntry(sheet)) return
    const values = [...sheet.querySelectorAll('input')].map(input => input.value)
    if (values[1] !== values[2]) {
      sheet.querySelector('[data-password-confirm]').closest('.field').classList.add('invalid')
      return
    }
    closeOverlay(sheet.closest('.overlay'))
    showToast('密码已更新，其他会话已失效')
  })
}

function initAdminActions() {
  document.querySelectorAll('[data-user-detail]').forEach(button => button.addEventListener('click', () => openOverlay('user-detail-sheet')))
  document.querySelectorAll('[data-user-actions]').forEach(button => button.addEventListener('click', () => openOverlay('user-actions-sheet')))
  document.querySelectorAll('[data-default-edit]').forEach(button => button.addEventListener('click', () => {
    const sheet = document.querySelector('#default-item-sheet .sheet')
    const row = button.closest('tr')
    sheet.querySelector('[data-default-type]').value = row.children[0].textContent.trim()
    sheet.querySelector('[data-default-name]').value = row.children[1].textContent.trim()
    sheet.__editingRow = row
    openOverlay('default-item-sheet')
  }))
  document.querySelector('[data-default-add]')?.addEventListener('click', () => {
    const sheet = document.querySelector('#default-item-sheet .sheet')
    sheet.querySelector('[data-default-name]').value = ''
    sheet.__editingRow = null
    openOverlay('default-item-sheet')
  })
  document.querySelectorAll('[data-default-toggle]').forEach(button => button.addEventListener('click', toggleDefaultState))
  document.querySelector('[data-default-save]')?.addEventListener('click', event => {
    const sheet = event.currentTarget.closest('.sheet')
    if (!validateEntry(sheet)) return
    const name = sheet.querySelector('[data-default-name]').value.trim()
    const type = sheet.querySelector('[data-default-type]').value
    const editingRow = sheet.__editingRow
    if (editingRow) {
      editingRow.children[0].textContent = type
      editingRow.children[1].textContent = name
    } else {
      const body = document.querySelector('[data-default-table-body]')
      const row = document.createElement('tr')
      row.innerHTML = '<td></td><td></td><td></td><td><span class="tag success">启用</span></td><td>新用户</td><td><div class="row-actions"><button data-default-edit>编辑</button><button data-default-toggle>停用</button></div></td>'
      row.children[0].textContent = type
      row.children[1].textContent = name
      row.children[2].textContent = String(body.children.length + 1)
      body.appendChild(row)
      row.querySelector('[data-default-edit]').addEventListener('click', () => {
        sheet.querySelector('[data-default-type]').value = row.children[0].textContent.trim()
        sheet.querySelector('[data-default-name]').value = row.children[1].textContent.trim()
        sheet.__editingRow = row
        openOverlay('default-item-sheet')
      })
      row.querySelector('[data-default-toggle]').addEventListener('click', toggleDefaultState)
    }
    sheet.__editingRow = null
    closeOverlay(sheet.closest('.overlay'))
    showToast('默认字典项已保存，仅影响之后创建的用户')
  })
  document.querySelectorAll('[data-reset-password]').forEach(button => button.addEventListener('click', () => {
    const result = document.querySelector('[data-reset-result]')
    if (result) { result.hidden = false; result.textContent = '新临时密码：Q7mK4pV9xT2rN6zA（仅本次展示，24 小时有效）' }
    showToast('旧会话已失效，重置动作已写入日志')
  }))
  document.querySelectorAll('[data-disable-user]').forEach(button => button.addEventListener('click', () => {
    const row = document.querySelector('[data-user-row]')
    const tag = row?.querySelector('.tag')
    if (tag) { tag.textContent = '停用'; tag.className = 'tag warning' }
    closeOverlay(button.closest('.overlay'))
    showToast('用户已停用，旧会话已失效，操作已写入日志')
  }))
}

function toggleDefaultState(event) {
  const button = event.currentTarget
  button.textContent = button.textContent === '停用' ? '恢复' : '停用'
  const tag = button.closest('tr').querySelector('.tag')
  tag.textContent = button.textContent === '恢复' ? '已停用' : '启用'
  tag.classList.toggle('success', button.textContent !== '恢复')
  showToast('默认字典状态已更新，仅影响之后创建的用户')
}

function initFilters() {
  document.querySelectorAll('[data-apply-filters]').forEach(button => button.addEventListener('click', () => {
    const overlay = button.closest('.overlay')
    const values = [...overlay.querySelectorAll('select')].map(select => select.value).filter(Boolean)
    const summary = document.querySelector('[data-filter-summary-text]')
    if (summary) summary.textContent = values.join(' · ')
    closeOverlay(overlay)
    showToast('筛选已应用，页面数据已刷新')
  }))
  document.querySelectorAll('[data-clear-filters]').forEach(button => button.addEventListener('click', () => {
    const overlay = button.closest('.overlay')
    overlay.querySelectorAll('select').forEach(select => { select.selectedIndex = 0 })
    const summary = document.querySelector('[data-filter-summary-text]')
    if (summary) summary.textContent = '本月 · 全部条件'
    closeOverlay(overlay)
    showToast('已恢复默认筛选')
  }))
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme()
  initIcons()
  initOverlays()
  initCommonActions()
  initPageState()
  initMoneyForms()
  initEntryTypes()
  initEntrySubmit()
  initReports()
  initReportDrill()
  initBillDetails()
  initAdmin()
  initDictionaries()
  initFilters()
  initReportFilters()
  initAdminActions()
  initProfileActions()
})
