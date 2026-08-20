import { css, htmlFiles, readPrototype } from './contract-test.helpers.mjs'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

for (const file of htmlFiles) {
  const html = readPrototype(file)
  assert(/name="viewport"[^>]*width=device-width[^>]*viewport-fit=cover/.test(html), `${file} 缺少移动端 viewport-fit=cover`)
}

const requiredFragments = [
  'font-size: 17px',
  'min-width: 320px',
  '100dvh',
  'safe-area-inset-top',
  'safe-area-inset-right',
  'safe-area-inset-bottom',
  'safe-area-inset-left',
  '@media (max-width: 419px)',
  '@media (max-width: 833px)',
  '@media (min-width: 736px) and (max-width: 833px)',
  '@media (min-width: 834px) and (max-width: 1023px)',
  '@media (min-width: 1024px)',
  '@media (prefers-reduced-motion: reduce)',
  'min-height: 44px',
  'width: 44px; height: 44px',
]

for (const fragment of requiredFragments) {
  assert(css.includes(fragment), `共享样式缺少响应式契约：${fragment}`)
}

assert(!/height:\s*calc\(100vh\s*-/.test(css), '禁止使用固定扣减的 100vh 主布局')
assert(/\.input-row\s*\{\s*grid-template-columns:\s*1fr;/.test(css), '小手机并排字段未降为单列')
assert(/\.overlay:not\(\.dialog-wrap\) \.sheet\s*\{[^}]*width:\s*min\(480px, 100%\)/s.test(css), '桌面筛选和编辑未切换为右侧抽屉')
assert(/\.overlay:not\(\.dialog-wrap\) \.sheet-handle\s*\{\s*display:\s*none;\s*\}/s.test(css), '桌面右侧抽屉仍保留手机拖拽暗示')
assert(/\.sidebar\s*\{[^}]*safe-area-inset-right[^}]*safe-area-inset-left/s.test(css), '管理端侧栏未消费横屏左右安全区')
assert(/\.admin-content\s*\{[^}]*safe-area-inset-right[^}]*safe-area-inset-left/s.test(css), '管理端主内容未消费横屏左右安全区')

console.log(`Responsive contract: OK (${htmlFiles.length} pages)`)
