import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// 消费已锁定的项目解析器；识别代码访问，不用字符串匹配把注释/界面文案当成存储调用。
const require = createRequire(new URL('../app/package.json', import.meta.url))
const ts = require('typescript')
const forbidden = new Set(['indexedDB', 'localStorage', 'sessionStorage', 'openDatabase', 'WebAssembly'])
export function assertNoWebStorage(source, filename) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(ast.parseDiagnostics.length, 0, '生产脚本不能被资源门禁解析')
  function constant(node) {
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = constant(node.left), right = constant(node.right)
      if (left !== undefined && right !== undefined) return left + right
    }
  }
  function visit(node) {
    if (ts.isIdentifier(node)) assert(!forbidden.has(node.text), '生产脚本包含禁止的 Web 存储/WASM 能力')
    if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const key = constant(node.argumentExpression)
      assert(key === undefined || !forbidden.has(key), '生产脚本包含禁止的 Web 存储/WASM 能力')
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
}
