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
  await page.locator('.delete-account-action').click()
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
