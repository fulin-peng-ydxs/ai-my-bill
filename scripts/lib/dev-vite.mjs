import { loadDevEnvironment } from './dev-environment.mjs'

// web 包的直接 dev/preview 入口也使用相同解析器，build/check 不读取开发配置。
try {
  loadDevEnvironment()
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
await import('../../web/node_modules/vite/bin/vite.js')
