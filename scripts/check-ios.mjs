import { spawn, execFile } from 'node:child_process'
import { readFile, mkdir, mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

// 两个终端复用检查逻辑；模拟器 DOM 事件只证明结构与状态，原生操作须另验。
const useSimulator = process.argv.includes('--simulator')
if (process.argv.slice(2).some((arg) => arg !== '--simulator')) throw new Error('仅支持 --simulator 参数')
const targetLabel = useSimulator ? '模拟器' : '真机'
const root = resolve(import.meta.dirname, '..')
const accountsDir = resolve(root, '.local/web/real-device-test')
const localDir = useSimulator ? resolve(root, '.local/web/simulator-test') : accountsDir
const config = await readFile(resolve(localDir, 'config.json'), 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === 'ENOENT') return {}
    throw error
  })
const baseUrl = process.env.MY_BILL_IOS_BASE_URL ?? config.baseUrl ?? (useSimulator ? 'http://127.0.0.1:5174' : undefined)
const account = process.env.MY_BILL_IOS_ACCOUNT ?? 'pengfulin'
const driverPort = useSimulator ? '14444' : '4444'
const driverUrl = `http://127.0.0.1:${driverPort}`
const runFile = promisify(execFile)
let driver
let sessionId
let originalType
let screenshotDir

let parsedUrl
try { parsedUrl = new URL(baseUrl) } catch { throw new Error('iOS 检查需要有效的本地 HTTP 地址及端口') }
const localHost = parsedUrl.hostname
const privateIp = localHost && /^(?:127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/.test(localHost)
const localAddress = privateIp || localHost === 'localhost' || localHost?.endsWith('.local')
const allowedUrl = useSimulator ? /^http:\/\/[^/]+:\d+$/ : /^http:\/\/[^/]+:5174$/
if (!baseUrl || !allowedUrl.test(baseUrl) || !localAddress || parsedUrl.username || parsedUrl.password) {
  throw new Error(`请在 ${useSimulator ? '.local/web/simulator-test' : '.local/web/real-device-test'}/config.json 设置本地 HTTP 地址及端口，或使用 MY_BILL_IOS_BASE_URL；真机入口固定为 5174`)
}
if (useSimulator && !config.deviceUDID) throw new Error('请在 .local/web/simulator-test/config.json 设置 iPhone 模拟器的 deviceUDID')
if (!['admin', 'pengfulin'].includes(account)) {
  throw new Error('MY_BILL_IOS_ACCOUNT 仅支持 admin 或 pengfulin')
}

async function request(method, path, body, timeoutMs = useSimulator ? 120000 : 30000) {
  try {
    const sensitive = path.endsWith('/value') || Boolean(body?.args?.length)
    const response = await fetch(`${driverUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const result = await response.json()
    if (result.value?.error) throw new Error(sensitive ? 'WebDriver 表单输入失败' : `${result.value.error}: ${result.value.message || '无详细信息'}`)
    return result.value
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error(`${method} ${path} 超时`)
    throw error
  }
}

async function ensureDriver() {
  try {
    await request('GET', '/status', undefined, 1000)
    return
  } catch {
    driver = spawn('/usr/bin/safaridriver', ['-p', driverPort], { stdio: 'ignore' })
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await request('GET', '/status', undefined, 1000)
      // The listener becomes ready before Safari finishes discovering a newly attached iPhone.
      await new Promise((done) => setTimeout(done, 1500))
      return
    } catch {
      await new Promise((done) => setTimeout(done, 200))
    }
  }
  throw new Error('safaridriver 未能启动')
}

async function ensureSimulator() {
  const { stdout } = await runFile('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { timeout: 30000 })
  const device = Object.values(JSON.parse(stdout).devices).flat().find((item) => item.udid === config.deviceUDID)
  if (!device || !device.isAvailable || !device.deviceTypeIdentifier?.includes('iPhone')) {
    throw new Error('配置的 iPhone 模拟器不可用，请检查 Xcode、iOS runtime 与 deviceUDID')
  }
  if (device.state !== 'Booted') {
    await runFile('/usr/bin/xcrun', ['simctl', 'boot', device.udid], { timeout: 30000 })
  }
  await runFile('/usr/bin/xcrun', ['simctl', 'bootstatus', device.udid, '-b'], { timeout: 120000 })
}

function elementId(element) {
  return element['element-6066-11e4-a52e-4f735466cecf']
}

async function find(selector) {
  return elementId(await request('POST', `/session/${sessionId}/element`, {
    using: 'css selector', value: selector,
  }))
}

async function waitFor(test, description) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await test()) return
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`等待${description}超时`)
}

async function evaluate(script, args = []) {
  return request('POST', `/session/${sessionId}/execute/sync`, { script, args })
}

async function click(selector, outside = false) {
  if (useSimulator) {
    await evaluate(`
      const node = document.querySelector(arguments[0])
      if (arguments[1]) node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
      node.click()
    `, [selector, outside])
  } else {
    await request('POST', `/session/${sessionId}/element/${await find(selector)}/click`)
  }
}

async function navigate(url) {
  if (!useSimulator) {
    await request('POST', `/session/${sessionId}/url`, { url })
    return
  }
  // none 导航策略避免加载超时；文档标记防止旧页面的同名控件提前满足等待。
  const marker = crypto.randomUUID()
  await evaluate('window.__myBillIosNavigation = arguments[0]', [marker])
  await request('POST', `/session/${sessionId}/url`, { url })
  await waitFor(() => evaluate('return window.__myBillIosNavigation !== arguments[0] && location.href === arguments[1] && document.readyState !== "loading"', [marker, url]), '新页面文档就绪')
}

async function restoreEntryType() {
  if (!originalType) return
  if (await evaluate('return location.pathname !== "/entry"')) await navigate(`${baseUrl}/entry`)
  const selector = `.entry-preference-page .page-workspace-header > .entry-type-switch button:nth-of-type(${originalType === 'EXPENSE' ? 1 : 2})`
  await waitFor(() => evaluate('return !!document.querySelector(arguments[0]) && !document.querySelector(arguments[0]).disabled', [selector]), '恢复记账类型前就绪')
  if (await evaluate('return document.querySelector(arguments[0]).getAttribute("aria-pressed") !== "true"', [selector])) {
    await click(selector)
  }
  // 等待偏好写入结束，不能只凭视图切换就销毁会话。
  await waitFor(() => evaluate('return document.querySelector(arguments[0])?.getAttribute("aria-pressed") === "true" && !document.querySelector(arguments[0]).disabled && !document.body.innerText.includes("正在保存最近类型") && !document.body.innerText.includes("最近类型尚未同步")', [selector]), '恢复原记账类型')
  originalType = undefined
}

async function screenshot(name) {
  const image = await request('GET', `/session/${sessionId}/screenshot`)
  if (!screenshotDir) {
    const parent = resolve(tmpdir(), 'ai-agent/ai-my-bill')
    await mkdir(parent, { recursive: true, mode: 0o700 })
    screenshotDir = await mkdtemp(resolve(parent, useSimulator ? 'ios-simulator-' : 'ios-device-'))
  }
  const file = resolve(screenshotDir, name)
  await writeFile(file, Buffer.from(image, 'base64'), { mode: 0o600 })
  await chmod(file, 0o600)
  return file
}

async function checkDate(selector, label) {
  const layout = await evaluate(`
    const input = document.querySelector(arguments[0])
    const rect = input.getBoundingClientRect()
    const outer = input.parentElement.getBoundingClientRect()
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      dateLeft: rect.left,
      dateRight: rect.right,
      dateWidth: rect.width,
      dateContainerWidth: outer.width,
    }
  `, [selector])
  if (layout.documentWidth > layout.viewport + 1 || layout.dateLeft < -1 ||
      layout.dateRight > layout.viewport + 1 || layout.dateWidth > layout.dateContainerWidth + 1) {
    throw new Error(`${label}页面存在横向溢出：${JSON.stringify(layout)}`)
  }
  console.log(`${label}：视口 ${layout.viewport}px，文档 ${layout.documentWidth}px，日期控件 ${Math.round(layout.dateWidth)}px`)
}

async function main() {
  const accounts = await readFile(resolve(accountsDir, 'accounts.md'), 'utf8')
  const row = accounts.split('\n').find((line) => line.startsWith(`| ${account} |`))
  const password = row?.split('|')[2]?.trim()
  if (!password) throw new Error(`本地账号文档缺少 ${account}`)

  if (useSimulator) await ensureSimulator()
  await ensureDriver()
  let session
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      session = await request('POST', '/session', {
        capabilities: { alwaysMatch: {
          browserName: 'safari', platformName: 'ios', 'safari:useSimulator': useSimulator,
          ...(config.deviceUDID ? { 'safari:deviceUDID': config.deviceUDID } : {}),
          ...(useSimulator ? { pageLoadStrategy: 'none' } : {}),
        } },
      })
      break
    } catch (error) {
      if (attempt === 2) throw error
      await new Promise((done) => setTimeout(done, 1500))
    }
  }
  sessionId = session.sessionId
  const capabilities = session.capabilities
  if (capabilities.platformName?.toLowerCase() !== 'ios' || capabilities['safari:useSimulator'] !== useSimulator ||
      (config.deviceUDID && capabilities['safari:deviceUDID'] !== config.deviceUDID)) {
    throw new Error(`WebDriver 未连接指定的${targetLabel}`)
  }
  console.log(`${targetLabel}：${capabilities['safari:deviceName']} / iOS ${capabilities['safari:platformVersion']}；useSimulator=${useSimulator}`)
  console.log(`页面：${baseUrl}；${useSimulator ? 'DOM 结构与状态检查，不证明原生触摸或完整键盘' : 'WebDriver 检查，不证明完整键盘'}`)

  await navigate(`${baseUrl}/login`)
  await waitFor(async () => evaluate('return !!document.querySelector("#username")'), '登录表单')
  await click('#username')
  await request('POST', `/session/${sessionId}/element/${await find('#username')}/value`, { text: account })
  await click('#password')
  await request('POST', `/session/${sessionId}/element/${await find('#password')}/value`, { text: password })
  let entered = await evaluate(`return {
    username: document.querySelector('#username')?.value,
    passwordLength: document.querySelector('#password')?.value.length
  }`)
  // Some iOS WebDriver versions acknowledge sendKeys without updating Vue's inputs.
  if (useSimulator || entered.username !== account || entered.passwordLength !== password.length) {
    await evaluate(`
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      for (const [selector, value] of [['#username', arguments[0]], ['#password', arguments[1]]]) {
        const input = document.querySelector(selector)
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    `, [account, password])
    entered = await evaluate(`return {
      username: document.querySelector('#username')?.value,
      passwordLength: document.querySelector('#password')?.value.length
    }`)
  }
  if (entered.username !== account || entered.passwordLength !== password.length) {
    throw new Error(`WebDriver 输入未完成：用户名=${entered.username === account ? '已填' : '未填'}，密码长度=${entered.passwordLength ?? 0}`)
  }
  await click('[data-testid="login-submit"]')
  await waitFor(async () => evaluate('return !location.pathname.includes("login")'), '登录完成')

  if (account === 'pengfulin') {
    await navigate(`${baseUrl}/entry`)
    await waitFor(async () => evaluate('return !!document.querySelector("#expense-occurred-at, #income-occurred-at") && !document.querySelector(".entry-preference-page .page-workspace-header > .entry-type-switch button:last-child")?.disabled'), '记账表单')
    originalType = await evaluate('return document.querySelector(".entry-preference-page .page-workspace-header > .entry-type-switch button:last-child").getAttribute("aria-pressed") === "true" ? "INCOME" : "EXPENSE"')
    if (originalType === 'INCOME') {
      await click('.entry-preference-page .page-workspace-header > .entry-type-switch button:nth-of-type(1)')
    }
    await waitFor(async () => evaluate('return !!document.querySelector("#expense-occurred-at")'), '记一笔页面')
    await waitFor(async () => evaluate('return !document.body.innerText.includes("正在加载填报选项") && !document.body.innerText.includes("正在保存最近类型")'), '支出选项加载')
    await checkDate('#expense-occurred-at', '支出填报')
    await evaluate('document.querySelector("#expense-occurred-at").scrollIntoView({ block: "center" })')
    const expenseDateImage = await screenshot('expense-date.png')
    // 将目标放入可见区中部；真机 WebDriver 点击需避开 Safari 工具栏。
    const categoryDetails = '.entry-category-picker'
    if (await evaluate('return !document.querySelector(arguments[0]).open', [categoryDetails])) {
      await click(`${categoryDetails} > summary`)
    }
    await evaluate('document.querySelector("#expense-primary-category").scrollIntoView({ block: "center" })')

    await click('#expense-primary-category')
    await waitFor(async () => evaluate('return document.querySelector("#expense-primary-category")?.getAttribute("aria-expanded") === "true"'), '分类下拉')
    const dropdown = await evaluate(`
      const anchor = document.querySelector('#expense-primary-category').getBoundingClientRect()
      const popup = document.querySelector('#expense-primary-category-options').getBoundingClientRect()
      const viewport = window.visualViewport
      return { anchorLeft: anchor.left, anchorRight: anchor.right,
        popupLeft: popup.left, popupRight: popup.right,
        viewportWidth: viewport?.width ?? window.innerWidth }
    `)
    if (dropdown.popupLeft < -1 || dropdown.popupRight > dropdown.viewportWidth + 1) {
      throw new Error(`分类下拉超出可见宽度：${JSON.stringify(dropdown)}`)
    }
    const dropdownImage = await screenshot('entry-dropdown.png')
    console.log(`分类下拉：左侧 ${Math.round(dropdown.popupLeft)}px，右侧 ${Math.round(dropdown.popupRight)}px，可见宽度 ${Math.round(dropdown.viewportWidth)}px`)

    const browse = await evaluate(`return {
      tag: document.querySelector('#expense-primary-category').tagName,
      height: document.querySelector('#expense-primary-category-options').getBoundingClientRect().height,
      scale: visualViewport?.scale ?? 1,
      viewportHeight: visualViewport?.height ?? innerHeight,
    }`)
    if (browse.tag !== 'BUTTON' || browse.height > 241 || browse.scale !== 1) {
      throw new Error(`手机分类选择入口或密度不符合约定：${JSON.stringify(browse)}`)
    }
    await click('#expense-primary-category')
    await waitFor(async () => evaluate('return !document.querySelector("#expense-primary-category-options")'), '重复点击收起')
    await click('#expense-primary-category')
    await click('#expense-primary-category-options .dropdown-search')
    await waitFor(async () => evaluate(`return document.querySelector('#expense-primary-category')?.tagName === 'BUTTON'
      && document.activeElement?.id === 'expense-primary-category-search'`), '主动搜索聚焦')
    // 记录真实可见视口，WebDriver 没有唤起键盘时不能用焦点通过冒充键盘验收。
    await new Promise((done) => setTimeout(done, 1000))
    const searchViewport = await evaluate(`
      const popup = document.querySelector('#expense-primary-category-options').getBoundingClientRect()
      const vv = visualViewport
      return { height: vv?.height ?? innerHeight, top: vv?.offsetTop ?? 0,
        scale: vv?.scale ?? 1, popupTop: popup.top, popupBottom: popup.bottom,
        popupHeight: popup.height, inputFont: getComputedStyle(document.querySelector('#expense-primary-category-search')).fontSize,
        keyboardOpen: document.querySelector('.app-shell').classList.contains('keyboard-open') }
    `)
    if (searchViewport.scale !== 1 || searchViewport.inputFont !== '16px' || searchViewport.popupHeight > 241
      || searchViewport.popupTop < searchViewport.top - 1
      || searchViewport.popupBottom > searchViewport.top + searchViewport.height + 1) {
      throw new Error(`搜索浮层不在可见区域：${JSON.stringify(searchViewport)}`)
    }
    console.log(`主动搜索：16px、无自动缩放；${searchViewport.keyboardOpen ? '实际键盘视口已收缩（须核对完整键盘画面）' : 'Safari WebDriver 抑制软件键盘，完整键盘状态未验证'}`)
    console.log(`搜索截图：${await screenshot('entry-dropdown-search.png')}`)
    await click('#expense-primary-category-options .dropdown-search-header button')
    await waitFor(async () => evaluate(`return !document.querySelector('#expense-primary-category-options')
      && document.activeElement?.id !== 'expense-primary-category-search'`), '取消搜索关闭候选')
    console.log('取消搜索：候选关闭，搜索输入失焦')
    await click('#expense-primary-category')
    await click('#expense-primary-category-options .dropdown-search')
    // 点非编辑页头关闭，不修改当前草稿或触发业务提交。
    await click('.page-heading h1', true)
    await waitFor(async () => evaluate(`return !document.querySelector('#expense-primary-category-options')
      && document.querySelector('#expense-primary-category')?.tagName === 'BUTTON'`), '外部点击收起搜索')

    // 用户在同一记账页切换类型；保留实例以覆盖共享页头与收支表单缓存。
    await waitFor(async () => evaluate('return !!document.querySelector(".entry-preference-page .page-workspace-header > .entry-type-switch button:last-child") && !document.querySelector(".entry-preference-page .page-workspace-header > .entry-type-switch button:last-child").disabled'), '记账类型切换')
    await click('.entry-preference-page .page-workspace-header > .entry-type-switch button:last-child')
    await waitFor(async () => evaluate('return !!document.querySelector("#income-occurred-at")'), '收入填报页面')
    await checkDate('#income-occurred-at', '收入填报')
    await waitFor(async () => evaluate('return !document.body.innerText.includes("正在保存最近类型") && !document.body.innerText.includes("最近类型尚未同步")'), '记账类型同步')
    await evaluate('document.querySelector("#income-occurred-at").scrollIntoView({ block: "center" })')
    const incomeDateImage = await screenshot('income-date.png')
    await restoreEntryType()
    console.log(`截图：${expenseDateImage}；${dropdownImage}；${incomeDateImage}`)
  } else {
    await waitFor(async () => evaluate('return location.pathname === "/admin" && document.querySelector("h1")?.textContent.includes("用户管理") && !document.body.innerText.includes("正在加载用户")'), '管理员数据加载')
    const page = await evaluate('return { path: location.pathname, width: document.documentElement.scrollWidth, viewport: innerWidth }')
    if (page.width > page.viewport + 1) throw new Error(`管理员页面横向溢出：${JSON.stringify(page)}`)
    console.log(`管理员：${page.path}，视口 ${page.viewport}px，文档 ${page.width}px`)
    console.log(`截图：${await screenshot('admin.png')}`)
  }
}

try {
  await mkdir(localDir, { recursive: true, mode: 0o700 })
  await chmod(localDir, 0o700)
  await main()
} catch (error) {
  console.error(`${targetLabel}检查失败：${error.message}`)
  if (sessionId) {
    try {
      const path = await evaluate('return location.pathname')
      console.error(`当前页面：${path}`)
      console.error(`诊断截图：${await screenshot('failure.png')}`)
    } catch { /* The device may have disconnected. */ }
  }
  process.exitCode = 1
} finally {
  if (sessionId) {
    try { await restoreEntryType() } catch {
      console.error('无法恢复原记账类型，请在测试账号页面检查；本轮检查未完成')
      process.exitCode = 1
    }
    try {
      await request('DELETE', `/session/${sessionId}`)
      await new Promise((done) => setTimeout(done, 1000))
    } catch { /* Driver may already have closed. */ }
  }
  if (driver) driver.kill()
}
