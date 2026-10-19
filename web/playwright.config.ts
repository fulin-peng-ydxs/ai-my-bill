import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const artifactParent = resolve(tmpdir(), 'ai-agent/ai-my-bill')
mkdirSync(artifactParent, { recursive: true, mode: 0o700 })
const artifactDir = mkdtempSync(resolve(artifactParent, 'e2e-'))
console.log(`E2E 临时产物：${artifactDir}`)

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: resolve(artifactDir, 'playwright'),
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { outputFolder: resolve(artifactDir, 'report'), open: 'never' }]] : 'line',
  use: {
    baseURL: process.env.MY_BILL_E2E_BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    ...devices['Desktop Chrome'],
  },
})
