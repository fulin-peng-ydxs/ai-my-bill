import type { Router } from 'vue-router'
import { requireValue, waitFor } from './domHarness'
import { observeCapacity } from '../test-support/capacityScenario'
import { seedCapacity } from '../test-support/capacityScenario'
import { withProbeDatabases } from './probeDatabases'
import { ledgerFiles } from '../src/platform/ledgerFiles'
import { NativeDatabase } from '../src/infrastructure/database/nativeAdapter'
import { type } from './domHarness'
import { formatCny,scaledIntegerToDecimal } from '../src/domain/money'

/** 只读页面语义与布局检查；原生 XCTest 调整真实 WKWebView frame，非浏览器模拟。 */
export async function reviewPages() {
  const app = (document.querySelector('#app') as Element & { __vue_app__: { config: { globalProperties: { $router: Router } } } }).__vue_app__
  const router = app.config.globalProperties.$router
  const pages = []
  for (const path of ['/entry','/reports','/ledger','/me','/me/dictionaries','/me/dictionaries/product']) {
    await router.push(path)
    await waitFor(() => Boolean(document.querySelector('h1')),`页面 ${path} 未就绪`)
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    requireValue(document.documentElement.scrollWidth <= innerWidth + 1, `${path} 整页横向溢出`)
    const page = document.querySelector<HTMLElement>('[data-page-key]')
    requireValue(page,`${path} 缺少工作区`)
    const visible = (element: Element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
    const unnamed = [...page.querySelectorAll('button,a,input:not([type=hidden]),textarea,select')].filter(visible).filter(element => {
      const label = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby')?.split(' ').map(id => document.getElementById(id)?.textContent).join(' ')
      const id = element.getAttribute('id')
      return !label && !element.textContent?.trim() && !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
    })
    requireValue(unnamed.length === 0, `${path} 无名控件：${unnamed.map(item => item.outerHTML).join(',')}`)
    pages.push({ path,heading:page.querySelector('h1')?.textContent?.trim(),width:innerWidth,height:innerHeight,
      controls:[...page.querySelectorAll('button,a,input,textarea,select')].filter(visible).length })
  }
  await router.push('/entry')
  requireValue(performance.getEntriesByType('resource').every(item => !/^https?:/.test(item.name)), '出现网络资源')
  return { pages,remoteResources:0 }
}

export async function capacity(count: number, mode: 'simulator' | 'device' = 'simulator') {
  if (mode !== 'simulator' && mode !== 'device') throw new Error('未知容量环境')
  return withProbeDatabases('scale',async (manager,prefix) => ({ ...await observeCapacity(manager('main'),count,mode),databasePrefix:prefix }))
}

/** 生成关闭后的原生夹具快照，由外部驱动仅向 capacity App 沙盒安装。 */
export async function prepareCapacity(count:number) {
  return withProbeDatabases('scale',async (manager,prefix) => {
    const db = manager('main'); await db.open(); await seedCapacity(db,count)
    const snapshot = await db.withClosed(() => ledgerFiles.snapshot({ name:db.name,reason:'restore' }))
    const datasetId = await db.read(async sql => String((await sql.query('SELECT dataset_id FROM ledger_meta'))[0].dataset_id))
    return { count,datasetId,databasePrefix:prefix,snapshot }
  })
}

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
async function paint() {
  for (const host of document.querySelectorAll<HTMLElement>('.report-result .chart-canvas')) {
    if (host.getBoundingClientRect().height && host.getBoundingClientRect().width)
      await waitFor(() => Boolean(host.querySelector('svg')),'实际 SVG 图表未完成加载')
  }
  // ECharts 使用 SVG；等数据发布后的 DOM/动画连续两帧稳定，不把旧快照当完成。
  let dirty = true, quiet = 0
  const observer = new MutationObserver(() => { dirty = true })
  observer.observe(document.querySelector('.report-page') ?? document.body,{ subtree:true,childList:true,attributes:true,characterData:true })
  try {
    for (let i = 0; i < 180; i++) {
      await frame()
      quiet = dirty ? 0 : quiet + 1; dirty = false
      if (quiet >= 2) return
    }
    throw new Error('页面图表未在有界帧数内稳定')
  } finally { observer.disconnect() }
}

/** 在隔离 App 的实际页面与正式路由/保存处理器上计时；不添加生产测试入口。 */
export async function capacityPages(count:number,mode:'simulator' | 'device',datasetId:string) {
  const sql = new NativeDatabase('ledger')
  requireValue((await sql.query('SELECT count(*) AS n FROM ledger_entry')).values?.[0]?.n === count,'页面账本规模与夹具不符')
  requireValue((await sql.query('SELECT dataset_id FROM ledger_meta')).values?.[0]?.dataset_id === datasetId,'页面账本与受管夹具数据集不符')
  const app = (document.querySelector('#app') as Element & { __vue_app__:{ config:{ globalProperties:{ $router:Router } } } }).__vue_app__
  const router = app.config.globalProperties.$router
  const range = { range:'CUSTOM',startDate:'2025-11-18',endDate:'2026-11-17' }
  const samples:Record<string,number[]> = {}, spans:Record<string,{ start:number,end:number }[]> = {}
  const times = mode === 'device' ? 30 : 1
  const noStale = () => !document.body.textContent?.includes('上次成功结果')
  type Options = { database?:string,values?:unknown[] }
  type NativePromise = (plugin:string,method:string,options?:Options) => Promise<unknown>
  const native = (window as unknown as { Capacitor:{ nativePromise:NativePromise } }).Capacitor
  const original = native.nativePromise
  let inFlight = 0, failed = 0, needle = '', queried = false
  // 只观察真实桥调用的完成；不替换结果，也不依赖生产包已移除的 Vue devtools 元数据。
  native.nativePromise = async (plugin,method,options) => {
    const observed = plugin === 'CapacitorSQLite' && options?.database === 'ledger'
    if (observed) inFlight++
    try {
      const result = await original.call(native,plugin,method,options)
      if (observed && method === 'query' && needle && options?.values?.some(value => typeof value === 'string' && value.includes(needle))) queried = true
      return result
    } catch (error) { if (observed) failed++; throw error }
    finally { if (observed) inFlight-- }
  }
  try {
  const measure = async (key:string,operation:(i:number) => Promise<void>) => {
    samples[key] = []; spans[key] = []
    for (let i = 0; i < times; i++) {
      const start = performance.timeOrigin + performance.now()
      await operation(i)
      const end = performance.timeOrigin + performance.now()
      samples[key].push(end-start); spans[key].push({ start,end })
    }
    console.log('IOS_CAPACITY_PAGE_STAGE '+key)
  }
  for (const key of ['list','filter']) await measure(key,async i => {
    needle = i%2 ? '测试' : '测'; queried = false
    await router.push({ path:'/ledger',query:{ ...range,q:needle,type:key === 'filter' ? 'EXPENSE' : 'ALL',lifecycle:'ACTIVE' } })
    await frame(); await frame()
    await waitFor(() => queried && inFlight === 0 && failed === 0 && noStale() && document.querySelectorAll('.ledger-list-item').length === 20,'明细容量首屏未完成')
    await paint()
  })
  // 编辑完整夹具中的原始支出，避免每次保存改变容量；准备表单不计人工输入等待。
  samples.save = []; spans.save = []
  const firstExpense = (await sql.query(`SELECT id FROM ledger_entry WHERE entry_type='EXPENSE' AND lifecycle_status='ACTIVE'
    ORDER BY business_date DESC,business_time DESC,created_at DESC,id DESC LIMIT 1`)).values?.[0]?.id
  requireValue(typeof firstExpense === 'string','容量支出标识缺失')
  for (let i = 0; i < times; i++) {
    needle = ''
    const item = document.querySelector<HTMLElement>('.ledger-list-item[aria-label^="支出 "]')
    requireValue(item,'容量页没有支出')
    item.click()
    await waitFor(() => Boolean(document.querySelector('#ledger-edit[open] #expense-paid-amount')),'容量编辑未打开')
    type('#ledger-edit[open] #expense-paid-amount',i%2 ? '20.02' : '20.01')
    const input = document.querySelector<HTMLInputElement>('#ledger-edit[open] #expense-paid-amount')!
    requireValue(input.form,'编辑表单不存在')
    const start = performance.timeOrigin + performance.now()
    input.form.requestSubmit()
    await waitFor(() => !document.querySelector('#ledger-edit[open]') && inFlight === 0 && failed === 0 && noStale() && document.body.textContent?.includes('支出修改已保存。') === true,'容量保存未完成')
    await paint()
    const end = performance.timeOrigin + performance.now()
    samples.save.push(end-start); spans.save.push({ start,end })
    const stored = (await sql.query('SELECT CAST(amount_cents AS TEXT) AS amount,row_version FROM ledger_entry WHERE id=?',[firstExpense])).values?.[0]
    requireValue(stored?.amount === (i%2 ? '2002' : '2001') && stored.row_version === i+2,'容量保存落盘或版本不符')
  }
  const views = [ ['ALL','OVERVIEW',undefined],...['DAY','WEEK','MONTH','QUARTER','YEAR'].map(grain => ['ALL','TIME',grain]),
    ...['CATEGORY','PRODUCT','FUNDING_CHANNEL','PURCHASE_CHANNEL','LOCATION','HABIT','PRICE','FREQUENCY','QUALITY'].map(d => ['EXPENSE',d,undefined]),
    ...['CATEGORY','FUNDING_CHANNEL','PAYER','NAME','FREQUENCY'].map(d => ['INCOME',d,undefined]) ]
  for (const [scope,dimension,grain] of views) {
    const key = dimension === 'OVERVIEW' ? 'overview' : grain ? 'time.'+grain : scope+'.'+dimension
    await measure(key,async i => {
      const q = i%2 ? '测试' : '测'
      needle = q; queried = false
      await router.push({ path:'/reports',query:{ ...range,q,scope,dimension,...(grain ? { grain } : {}) } })
      await frame()
      await waitFor(() => queried && inFlight === 0 && failed === 0 && noStale() &&
        document.querySelector<HTMLSelectElement>('#report-dimension')?.value === dimension &&
        (!grain || document.querySelector<HTMLSelectElement>('#report-grain')?.value === grain) &&
        Boolean(document.querySelector('.report-result:not([disabled])[aria-busy=false]')),'容量报表未发布当前快照')
      await paint()
      const income = BigInt(count/2)*100000n, gross = BigInt(count/2-count/10+1)*1500n+(times%2 ? 501n : 502n)
      const adjustment = BigInt(count/20)*100n
      const expected:Record<string,bigint> = { '总收入':income,'原始支出':gross,'退款/报销冲减':adjustment,'净支出':gross-adjustment,'结余':income-gross+adjustment }
      if (dimension !== 'TIME') {
        const amounts = [...document.querySelectorAll('[aria-label="已展示条件金额摘要"] .money-summary-item')]
        requireValue(amounts.length === (scope === 'ALL' ? 5 : scope === 'EXPENSE' ? 3 : 1),'容量摘要数量不符')
        for (const amount of amounts) {
          const label = amount.querySelector('dt')?.textContent?.trim() ?? ''
          requireValue(label in expected && amount.querySelector('dd')?.textContent?.includes(formatCny(scaledIntegerToDecimal(expected[label]!,2))),'容量摘要金额不符：'+label)
        }
      }
    })
  }
  requireValue((await sql.query('SELECT count(*) AS n FROM ledger_entry')).values?.[0]?.n === count,'页面容量测试新增或丢失账目')
  return { count,datasetId,samples,spans,scope:'page-e2e',correctness:true,crashed:false }
  } finally { native.nativePromise = original }
}
