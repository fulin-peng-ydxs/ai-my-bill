import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 仅供 XCTest test bundle 注入；不进入 App/public 或生产入口依赖图。
export default defineConfig({
  plugins: [vue()],
  // Vite library 模式不替换 NODE_ENV；探针在 WKWebView 中运行，不能依赖 Node 全局。
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    target: 'es2022',
    outDir: '.native-test',
    lib: {
      entry: fileURLToPath(new URL('./sqliteProbe.ts', import.meta.url)),
      name: 'MyBillNativeProbe',
      formats: ['iife'],
      fileName: () => 'sqlite-probe.js',
    },
  },
})
