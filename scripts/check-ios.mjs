import { spawn } from 'node:child_process'
import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises'
import { resolve } from 'node:path'

// Only the real iPhone Safari session can satisfy this check; credentials stay out of Git and logs.
const root = resolve(import.meta.dirname, '..')
const localDir = resolve(root, '.local/real-device-test')
const config = await readFile(resolve(localDir, 'config.json'), 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === 'ENOENT') return {}
    throw error
  })
const baseUrl = process.env.MY_BILL_IOS_BASE_URL ?? config.baseUrl
const account = process.env.MY_BILL_IOS_ACCOUNT ?? 'pengfulin'
const driverUrl = 'http://127.0.0.1:4444'
let driver
let sessionId

const localHost = baseUrl && new URL(baseUrl).hostname
const privateIp = localHost && /^(?:127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/.test(localHost)
if (!baseUrl || !/^http:\/\/[^/]+:5174$/.test(baseUrl) || !(privateIp || localHost === 'localhost' || localHost?.endsWith('.local'))) {
  throw new Error('请在 .local/real-device-test/config.json 设置本地开发地址，例如 http://<手机可访问的本机地址>:5174')
}
if (!['admin', 'pengfulin'].includes(account)) {
  throw new Error('MY_BILL_IOS_ACCOUNT 仅支持 admin 或 pengfulin')
}

async function request(method, path, body) {
  try {
    const sensitive = path.endsWith('/value') || Boolean(body?.args?.length)
    const response = await fetch(`${driverUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
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
    await request('GET', '/status')
    return
  } catch {
    driver = spawn('/usr/bin/safaridriver', ['-p', '4444'], { stdio: 'ignore' })
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await request('GET', '/status')
      // The listener becomes ready before Safari finishes discovering a newly attached iPhone.
      await new Promise((done) => setTimeout(done, 1500))
      return
    } catch {
      await new Promise((done) => setTimeout(done, 200))
    }
  }
  throw new Error('safaridriver 未能启动')
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

async function screenshot(name) {
  const image = await request('GET', `/session/${sessionId}/screenshot`)
  const file = resolve(localDir, name)
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
  const accounts = await readFile(resolve(localDir, 'accounts.md'), 'utf8')
  const row = accounts.split('\n').find((line) => line.startsWith(`| ${account} |`))
  const password = row?.split('|')[2]?.trim()
  if (!password) throw new Error(`本地账号文档缺少 ${account}`)

  await ensureDriver()
  let session
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      session = await request('POST', '/session', {
        capabilities: { alwaysMatch: {
          browserName: 'safari', platformName: 'ios', 'safari:useSimulator': false,
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
  if (capabilities.platformName?.toLowerCase() !== 'ios' || capabilities['safari:useSimulator'] !== false ||
      (config.deviceUDID && capabilities['safari:deviceUDID'] !== config.deviceUDID)) {
    throw new Error('WebDriver 未连接实体 iPhone')
  }
  console.log(`真机：${capabilities['safari:deviceName']} / iOS ${capabilities['safari:platformVersion']}`)

  await request('POST', `/session/${sessionId}/url`, { url: `${baseUrl}/login` })
  await waitFor(async () => evaluate('return !!document.querySelector("#username")'), '登录表单')
  await request('POST', `/session/${sessionId}/element/${await find('#username')}/click`)
  await request('POST', `/session/${sessionId}/element/${await find('#username')}/value`, { text: account })
  await request('POST', `/session/${sessionId}/element/${await find('#password')}/click`)
  await request('POST', `/session/${sessionId}/element/${await find('#password')}/value`, { text: password })
  let entered = await evaluate(`return {
    username: document.querySelector('#username')?.value,
    passwordLength: document.querySelector('#password')?.value.length
  }`)
  // Some iOS WebDriver versions acknowledge sendKeys without updating Vue's inputs.
  if (entered.username !== account || entered.passwordLength !== password.length) {
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
  await request('POST', `/session/${sessionId}/element/${await find('[data-testid="login-submit"]')}/click`)
  await waitFor(async () => evaluate('return !location.pathname.includes("login")'), '登录完成')

  if (account === 'pengfulin') {
    await request('POST', `/session/${sessionId}/url`, { url: `${baseUrl}/entry` })
    await waitFor(async () => evaluate('return !!document.querySelector("#expense-occurred-at, #income-occurred-at") && !document.querySelector(".entry-type-panel > .entry-type-switch button:last-child")?.disabled'), '记账表单')
    const originalType = await evaluate('return document.querySelector(".entry-type-panel > .entry-type-switch button:last-child").getAttribute("aria-pressed") === "true" ? "INCOME" : "EXPENSE"')
    if (originalType === 'INCOME') {
      await request('POST', `/session/${sessionId}/element/${await find('.entry-type-panel > .entry-type-switch button:nth-of-type(1)')}/click`)
    }
    await waitFor(async () => evaluate('return !!document.querySelector("#expense-occurred-at")'), '记一笔页面')
    await waitFor(async () => evaluate('return !document.body.innerText.includes("正在加载填报选项") && !document.body.innerText.includes("正在保存最近类型")'), '支出选项加载')
    await checkDate('#expense-occurred-at', '支出填报')
    await evaluate('document.querySelector("#expense-occurred-at").scrollIntoView({ block: "center" })')
    const expenseDateImage = await screenshot('expense-date.png')

    await request('POST', `/session/${sessionId}/element/${await find('#expense-primary-category')}/click`)
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

    await request('POST', `/session/${sessionId}/url`, { url: `${baseUrl}/entry?ios-check=income` })
    await waitFor(async () => evaluate('return !!document.querySelector(".entry-type-panel > .entry-type-switch button:last-child")'), '记账类型切换')
    await request('POST', `/session/${sessionId}/element/${await find('.entry-type-panel > .entry-type-switch button:last-child')}/click`)
    await waitFor(async () => evaluate('return !!document.querySelector("#income-occurred-at")'), '收入填报页面')
    await checkDate('#income-occurred-at', '收入填报')
    await waitFor(async () => evaluate('return !document.body.innerText.includes("正在保存最近类型")'), '记账类型同步')
    await evaluate('document.querySelector("#income-occurred-at").scrollIntoView({ block: "center" })')
    const incomeDateImage = await screenshot('income-date.png')
    if (originalType === 'EXPENSE') {
      await request('POST', `/session/${sessionId}/element/${await find('.entry-type-panel > .entry-type-switch button:nth-of-type(1)')}/click`)
      await waitFor(async () => evaluate('return !!document.querySelector("#expense-occurred-at")'), '恢复原记账类型')
    }
    console.log(`截图：${expenseDateImage}；${dropdownImage}；${incomeDateImage}`)
  } else {
    await waitFor(async () => evaluate('return !document.body.innerText.includes("正在加载用户")'), '管理员数据加载')
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
  console.error(`真机检查失败：${error.message}`)
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
    try {
      await request('DELETE', `/session/${sessionId}`)
      await new Promise((done) => setTimeout(done, 1000))
    } catch { /* Driver may already have closed. */ }
  }
  if (driver) driver.kill()
}
