import { readFileSync } from 'node:fs'

import type { Plugin } from 'vite'

const webRoot = new URL('../', import.meta.url)

/** 首屏、安装与离线资产从应用 token 生成颜色，避免静态入口维护第二份色板。 */
export function themeAssets(): Plugin {
  function render(template: string): string {
    const css = readFileSync(new URL('src/styles/tokens.css', webRoot), 'utf8')
    const light = css.match(/:root\s*\{([^}]+)\}/)?.[1] ?? ''
    const dark = css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1] ?? ''
    const background = (block: string): string => {
      const value = block.match(/--color-background:\s*([^;]+);/)?.[1]
      if (!value) throw new Error('主题缺少页面背景 token')
      return value.trim()
    }
    const colors = (block: string): string => Array.from(block.matchAll(/--color-[\w-]+:\s*[^;]+;/g), (match) => match[0]).join('\n')
    return template
      .replaceAll('__THEME_LIGHT_BACKGROUND__', background(light))
      .replaceAll('__THEME_DARK_BACKGROUND__', background(dark))
      .replaceAll('__THEME_COLOR_CSS__', `:root { ${colors(light)} }\n@media (prefers-color-scheme: dark) { :root { ${colors(dark)} } }`)
  }

  const assets = [
    { name: 'manifest.webmanifest', type: 'application/manifest+json' },
    { name: 'offline.html', type: 'text/html; charset=utf-8' },
  ]
  return {
    name: 'my-bill-theme-assets',
    transformIndexHtml: { order: 'pre', handler: (html) => render(html) },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const asset = assets.find((item) => request.url?.split('?')[0] === `/${item.name}`)
        if (!asset) return next()
        response.setHeader('Content-Type', asset.type)
        response.end(render(readFileSync(new URL(`templates/${asset.name}`, webRoot), 'utf8')))
      })
    },
    generateBundle() {
      for (const asset of assets) {
        this.emitFile({ type: 'asset', fileName: asset.name, source: render(readFileSync(new URL(`templates/${asset.name}`, webRoot), 'utf8')) })
      }
    },
  }
}
