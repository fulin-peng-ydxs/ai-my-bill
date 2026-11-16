import { compileStyle, parse } from '@vue/compiler-sfc'
import { parse as parseTemplate, NodeTypes, type TemplateChildNode } from '@vue/compiler-dom'
import ts from 'typescript'

/** 只检查实际本地组件绑定和渲染，不接受注释中的假导入/假标签。 */
export function renderedImports(source: string): Map<string,string> {
  const { descriptor, errors } = parse(source)
  if (errors.length) throw new Error('Vue 文件不能解析')
  const imports = new Map<string,string>()
  const script = ts.createSourceFile('component.ts', descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '', ts.ScriptTarget.Latest, true)
  for (const item of script.statements) {
    if (ts.isImportDeclaration(item) && ts.isStringLiteral(item.moduleSpecifier) && item.moduleSpecifier.text.endsWith('.vue') && item.importClause?.name) {
      imports.set(item.importClause.name.text, item.moduleSpecifier.text)
    }
  }
  const rendered = new Set<string>()
  function visit(nodes: TemplateChildNode[]) {
    for (const node of nodes) if (node.type === NodeTypes.ELEMENT) {
      rendered.add(node.tag)
      visit(node.children)
    }
  }
  visit(parseTemplate(descriptor.template?.content ?? '').children)
  return new Map([...imports].filter(([name]) => rendered.has(name)))
}

export function assertComponentRegistration(sources: readonly string[], design: string, required: readonly string[]): void {
  const table = design.match(/<!-- component-registry:start -->([\s\S]*?)<!-- component-registry:end -->/)?.[1]
  if (!table) throw new Error('组件登记表缺失')
  const registered = new Set([...table.matchAll(/^\|([^|]+)\|/gm)].flatMap(row => [...row[1].matchAll(/`([^`]+)`/g)].map(m => m[1])))
  const consumed = new Set(sources.flatMap(source => [...renderedImports(source).keys()]))
  for (const name of required) {
    if (!registered.has(name) || !consumed.has(name)) throw new Error(`组件未登记或无真实渲染消费者：${name}`)
  }
}

export function assertNoPrivateColors(source: string): void {
  const { descriptor } = parse(source)
  for (const style of descriptor.styles) {
    const result = compileStyle({ source: style.content, filename: 'component.vue', id: 'design-policy' })
    if (result.errors.length) throw new Error('组件样式不能解析')
    result.rawResult?.root?.walkDecls(declaration => {
      // 只读 CSS 声明值；选择器、资源片段及文案中的 #abc 不是私有颜色。
      const value = declaration.value.replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/url\([^)]*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi, '')
      if (/(?:#[\da-f]{3,8}\b|rgba?\s*\(|hsla?\s*\()/i.test(value)) {
        throw new Error('组件使用私有颜色，必须消费主题 token')
      }
    })
  }
}

/** 一个个人页面角色只登记一个路径；路由和文档必须消费同一事实。 */
export function assertPageRegistration(
  pages: readonly { pageKey: string; path: string }[],
  routeNames: readonly string[],
  design: string,
): void {
  const keys = new Set<string>()
  const paths = new Set<string>()
  const table = design.match(/<!-- page-registry:start -->([\s\S]*?)<!-- page-registry:end -->/)?.[1] ?? ''
  for (const page of pages) {
    if (keys.has(page.pageKey) || paths.has(page.path)) throw new Error('页面角色或路径重复')
    if (!routeNames.includes(page.pageKey) || !table.includes('`' + page.pageKey + '`')) throw new Error('页面登记缺少真实路由或文档')
    keys.add(page.pageKey)
    paths.add(page.path)
  }
  if (routeNames.some(name => !keys.has(name))) throw new Error('存在未登记的页面路由')
}
