import { expect, test, type Page } from '@playwright/test'

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.getByTestId('login-submit').click()
}

test('普通用户登录后可查看隔离样本的明细和报表，管理页面安全拒绝', async ({ page }) => {
  await login(page, 'e2e-user', 'E2E-Formal-Password-2026')
  await expect(page).toHaveURL(/\/entry$/)
  await expect(page.locator('[data-page-key="ledger-entry"]')).toBeVisible()

  await page.goto('/ledger')
  await expect(page.getByRole('heading', { name: '收支明细' })).toBeVisible()
  await expect(page.getByText('发布候选咖啡', { exact: true })).toBeVisible()

  await page.goto('/reports')
  await expect(page.getByRole('heading', { name: '收支报表' })).toBeVisible()
  await expect(page.getByText('18.50', { exact: false }).first()).toBeVisible()

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByText('无权访问此页面')).toBeVisible()
})

test('管理员进入管理端且不能进入普通用户页面', async ({ page }) => {
  await login(page, 'e2e-admin', 'E2E-Admin-Password-2026')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible()

  await page.goto('/entry')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible()
})

test('注销遭遇会话失效时不清草稿、不宣称删除，账号仍可登录', async ({ page }) => {
  await login(page, 'e2e-user', 'E2E-Formal-Password-2026')
  await expect(page).toHaveURL(/\/entry$/)
  await page.goto('/me')
  await page.getByRole('button', { name: '注销账号', exact: true }).click()
  await page.locator('#deletion-confirmation').fill('e2e-user')
  const draftKey = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/session', { cache: 'no-store' })
    const session = await response.json() as { accountId: string }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`my-bill/account/v1/${session.accountId.toLowerCase()}`))
    const namespace = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    const key = `my-bill:account:v1:${namespace}:draft:EXPENSE`
    localStorage.setItem(key, 'deletion-failure-must-preserve')
    const csrf = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('XSRF-TOKEN='))?.slice('XSRF-TOKEN='.length)
    const logout = await fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'X-XSRF-TOKEN': decodeURIComponent(csrf ?? '') } })
    if (!logout.ok) throw new Error(`logout failed: ${logout.status}`)
    return key
  })
  await page.getByRole('dialog').getByRole('button', { name: '永久注销', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('未确认注销成功，本地数据已保留')
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBe('deletion-failure-must-preserve')
  expect(page.url()).not.toContain('deleted=1')
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await login(page, 'e2e-user', 'E2E-Formal-Password-2026')
  await expect(page).toHaveURL(/\/entry$/)
})

test('手机票据录入保留草稿与手动实付，连续保存后可从明细修改并重新读取', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'e2e-user', 'E2E-Formal-Password-2026')
  const entry = page.locator('[data-page-key="ledger-entry"]')
  await entry.locator('.entry-type-switch').getByRole('button', { name: '支出', exact: true }).click()

  await entry.getByRole('button', { name: '保存支出', exact: true }).click()
  await expect(entry.locator('.entry-category-picker')).toHaveAttribute('open', '')
  await expect(entry.getByText('请选择一级分类。', { exact: true })).toBeVisible()
  await entry.locator('#expense-product-search').click()
  await page.getByRole('option', { name: '发布候选咖啡 最近 ¥18.5', exact: true }).click()
  await expect(entry.locator('#expense-unit-price')).toHaveValue('18.5')
  await entry.locator('#expense-paid-amount').fill('26')
  await entry.locator('#expense-quantity').fill('2')
  await expect(entry.locator('#expense-paid-amount')).toHaveValue('26')
  await expect(entry.locator('#expense-paid-amount-help')).toContainText('计算金额 ¥37')

  await entry.locator('.entry-receipt > .form-disclosure > summary').click()
  await entry.locator('#expense-note').fill('票据录入回归')
  await page.getByRole('link', { name: '我的', exact: true }).click()
  await page.getByRole('link', { name: '记一笔', exact: true }).click()
  await expect(entry.locator('#expense-paid-amount')).toHaveValue('26')
  await entry.locator('.entry-type-switch').getByRole('button', { name: '收入', exact: true }).click()
  await expect(entry.locator('#income-amount')).toBeVisible()
  await entry.locator('.entry-type-switch').getByRole('button', { name: '支出', exact: true }).click()
  await expect(entry.locator('#expense-paid-amount')).toHaveValue('26')

  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/expenses')
    && response.request().method() === 'POST')
  await entry.getByRole('button', { name: '保存并继续', exact: true }).click()
  const created = await createdResponse
  expect(created.ok()).toBeTruthy()
  const expense = await created.json() as { id: string }
  await expect(entry.locator('.saved-entry-summary')).toContainText('−¥26')
  await expect(entry.locator('#expense-paid-amount')).toHaveValue('')
  await expect(entry.locator('#expense-funding-channel')).toContainText('发布候选钱包')

  await page.getByRole('link', { name: '收支明细', exact: true }).click()
  await page.locator('.ledger-list-item').filter({ hasText: '票据录入回归' }).click()
  const editor = page.locator('#ledger-edit')
  await expect(editor.locator('#expense-paid-amount')).toHaveValue('26')
  await editor.locator('#expense-paid-amount').fill('28')
  await editor.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await expect(page.locator('.ledger-list-item').filter({ hasText: '票据录入回归' })).toContainText('−¥28')
  const persisted = await page.request.get(`/api/v1/expenses/${expense.id}`)
  expect(persisted.ok()).toBeTruthy()
  expect(await persisted.json()).toMatchObject({ paidAmount: '28.00', quantity: '2', note: '票据录入回归' })
})

test.describe('收入名称候选交互', () => {
  // 本用例明确使用候选夹具；SW 网络转发会绕过页面路由拦截。
  test.use({ serviceWorkers: 'block' })
  test('手机收入名称候选可选择、搜索和填写，取消不覆盖已确认的名称', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/api/v1/incomes/names?*', async route => {
      const query = new URL(route.request().url()).searchParams.get('query') ?? ''
      await route.fulfill({ json: { items: ['月度工资', '兼职收入'].filter(name => name.includes(query)) } })
    })
    await login(page, 'e2e-user', 'E2E-Formal-Password-2026')
    const entry = page.locator('[data-page-key="ledger-entry"]')
    await entry.locator('.entry-type-switch').getByRole('button', { name: '收入', exact: true }).click()
    await entry.locator('#income-name').click()
    await page.getByRole('option', { name: '月度工资', exact: true }).click()
    await expect(entry.locator('#income-name')).toContainText('月度工资')

    await entry.locator('#income-name').click()
    await page.getByRole('button', { name: '搜索或填写收入名称', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索收入名称', exact: true }).fill('兼职')
    await page.getByRole('option', { name: '兼职收入', exact: true }).click()
    await expect(entry.locator('#income-name')).toContainText('兼职收入')

    await entry.locator('#income-name').click()
    await page.getByRole('button', { name: '搜索或填写收入名称', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索收入名称', exact: true }).fill('新收入')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(entry.locator('#income-name')).toContainText('兼职收入')

    await entry.locator('#income-name').click()
    await page.getByRole('button', { name: '搜索或填写收入名称', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索收入名称', exact: true }).fill('新收入')
    await page.getByRole('button', { name: '使用“新收入”', exact: true }).click()
    await page.getByRole('link', { name: '我的', exact: true }).click()
    await page.getByRole('link', { name: '记一笔', exact: true }).click()
    await expect(entry.locator('#income-name')).toContainText('新收入')
  })
})
