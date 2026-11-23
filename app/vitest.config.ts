import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: { include: ['src/**/*.spec.ts'], environment: 'node', coverage: {
    provider: 'v8', include: ['src/**/*.{ts,vue}'],
    exclude: ['src/**/*.spec.ts','src/**/*.d.ts','src/api/generated/**'],
    reporter: ['json','json-summary'],
  } },
})
