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
  document.querySelectorAll('[data-open]').forEach(trigger => trigger.addEventListener('click', () => openOverlay(trigger.dataset.open)))
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
  const state = new URLSearchParams(location.search).get('state') || 'ready'
  if (state === 'ready') return
  const definitions = {
    loading: ['正在加载', '正在读取最新数据，请稍候。', ''],
    empty: ['暂时没有数据', '完成第一笔记录后，这里会显示内容。', '去记一笔'],
    error: ['数据加载失败', '网络或服务暂时不可用，请重试。', '重新加载'],
    permission: ['无权访问', '当前账号没有访问此页面的权限。', '返回登录']
  }
  const selected = definitions[state] || definitions.error
  content.hidden = true
  const block = document.createElement('section')
  block.className = `state page-state ${state === 'error' || state === 'permission' ? 'error' : ''}`
  const href = state === 'empty' ? 'expense-entry.html' : state === 'permission' ? 'login.html' : `${location.pathname.split('/').pop()}`
  block.innerHTML = `<div class="state-stack"><div><strong>${selected[0]}</strong><span>${selected[1]}</span></div>${selected[2] ? `<a class="btn ${state === 'error' ? 'primary' : ''}" href="${href}">${selected[2]}</a>` : '<div class="skeleton-line" aria-hidden="true"></div>'}</div>`
  content.parentElement.insertBefore(block, content)
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
    button.disabled = true
    const original = button.textContent
    button.textContent = '保存中…'
    setTimeout(() => {
      button.disabled = false
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
    }, 350)
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
      return `<button type="button" class="bar${index === 0 ? ' active' : ''}${seriesClass}" style="--h:${height}%" data-dimension="${key}" data-label="${label}" data-value="${value}" aria-label="${label}，${value}"><span>${label}</span></button>`
    }).join('')
    initReportDrill(chart)
    const ranking = document.querySelector('[data-report-ranking]')
    const rankingTitle = document.querySelector('[data-ranking-title]')
    if (rankingTitle) rankingTitle.textContent = scope === 'income' ? '收入排行' : scope === 'expense' ? '支出排行' : '本月构成'
    if (ranking) ranking.innerHTML = view[2].slice(0, 3).map((item, index) => {
      const [label, value] = item.split('|')
      const sign = scope === 'expense' ? '−' : scope === 'income' ? '+' : ''
      return `<button class="rank-row" data-drill data-dimension="${key}" data-value="${label}"><span class="rank-index">0${index + 1}</span><span>${label}</span><strong class="rank-value ${scope === 'expense' ? 'expense-amount' : scope === 'income' ? 'income-amount' : ''}">${sign}${isNaN(Number(value)) ? value : `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`}</strong></button>`
    }).join('')
    initReportDrill(ranking || document)
  }
  const renderScope = nextScope => {
    scope = nextScope
    document.querySelectorAll('[data-report-scope]').forEach(button => {
      const active = button.dataset.reportScope === scope
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
    const dimensions = document.querySelector('[data-report-dimensions]')
    dimensions.innerHTML = reportScopes[scope].map((item, index) => `<button class="chip${index === 0 ? ' active' : ''}" data-report-dimension="${item.key}" aria-pressed="${index === 0}">${item.label}</button>`).join('')
    dimensions.querySelectorAll('[data-report-dimension]').forEach(button => button.addEventListener('click', () => {
      dimensions.querySelectorAll('[data-report-dimension]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)) })
      render(button.dataset.reportDimension)
    }))
    render(reportScopes[scope][0].key)
  }
  document.querySelectorAll('[data-report-scope]').forEach(button => button.addEventListener('click', () => renderScope(button.dataset.reportScope)))
  renderScope('overview')
}

function initReportDrill(root = document) {
  root.querySelectorAll('[data-drill], .bar[data-dimension]').forEach(item => {
    if (item.dataset.drillBound === 'true') return
    item.dataset.drillBound = 'true'
    item.addEventListener('click', () => {
    const dimension = item.dataset.dimension || 'product'
    const value = item.dataset.value || item.dataset.label || ''
    location.href = `bill-details.html?source=reports&dimension=${encodeURIComponent(dimension)}&value=${encodeURIComponent(value)}`
    })
  })
}

function initBillDetails() {
  const context = document.querySelector('[data-drill-context]')
  const params = new URLSearchParams(location.search)
  if (context && params.get('source') === 'reports') {
    context.hidden = false
    context.querySelector('span').textContent = `来自报表 · ${params.get('dimension') || '筛选'}：${params.get('value') || '全部'}`
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
  document.querySelectorAll('[data-dictionary]').forEach(button => button.addEventListener('click', () => {
    if (!title || !list) return
    const name = button.dataset.dictionary
    title.textContent = `${name}管理`
    list.innerHTML = `<div class="list-item"><div><div class="item-title">${name}示例一</div><div class="item-meta">可改名、排序或停用；历史引用保留</div></div><span class="tag success">启用</span></div><div class="list-item"><div><div class="item-title">${name}示例二</div><div class="item-meta">已停用项不进入新填报</div></div><span class="tag">已停用</span></div>`
    openOverlay('dictionary-sheet')
  }))
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
})
