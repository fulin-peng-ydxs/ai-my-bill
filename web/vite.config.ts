import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

import { themeAssets } from './build/themeAssets.ts'

const buildId = (process.env.MY_BILL_BUILD_ID ?? process.env.npm_package_version ?? 'local')
  .replace(/[^a-zA-Z0-9._-]/g, '-')
// 所有前端启动入口共用监听默认值；显式 --host 仍由 Vite 优先处理。
const webHost = process.env.MY_BILL_WEB_HOST || '0.0.0.0'
const apiProxy = {
  '/api/v1': {
    target: `http://127.0.0.1:${process.env.MY_BILL_SERVER_PORT ?? '8080'}`,
    changeOrigin: false,
  },
}

export default defineConfig({
  plugins: [vue(), themeAssets()],
  define: {
    __MY_BILL_CACHE_NAME__: JSON.stringify(`my-bill-static-${buildId}`),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: webHost,
    proxy: apiProxy,
  },
  preview: {
    host: webHost,
    proxy: apiProxy,
  },
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        sw: fileURLToPath(new URL('./src/sw.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    environment: 'node',
  },
})
