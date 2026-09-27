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
