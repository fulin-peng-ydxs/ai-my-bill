import { readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))

// 只补充未导出的变量；配置是数据，不做 shell 执行、变量展开或浏览器注入。
export function readDevEnvironment(root = projectRoot, environment = process.env) {
  let source
  try {
    const path = resolve(root, '.local/web/dev.env')
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > 65536) throw new Error('Invalid development env file')
    source = readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error('无法读取 .local/web/dev.env，请检查文件、权限及大小（不超过 64 KiB 的普通文件）。')
  }
  if (Buffer.byteLength(source) > 65536 || source.includes('\0')) {
    throw new Error('.local/web/dev.env 超出 64 KiB 或包含无效字符。')
  }

  const values = {}
  const names = new Set()
  for (const [index, line] of source.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(text)
    const fail = () => { throw new Error(`.local/web/dev.env 第 ${index + 1} 行无效：使用单行 KEY=value，仅支持 MY_BILL_* 和 JAVA_HOME，且键不能重复。`) }
    if (!match) fail()
    const [, name, rawValue] = match
    if ((!name.startsWith('MY_BILL_') && name !== 'JAVA_HOME') || names.has(name)) fail()
    // 单行格式避免 Node parseEnv 对未闭合引号和无效行的宽松解析静默吞掉配置。
    if (/^["'`]/.test(rawValue) && !/^(["'`]).*\1\s*(?:#.*)?$/.test(rawValue)) fail()
    const parsed = parseEnv(text)
    if (!Object.hasOwn(parsed, name)) fail()
    names.add(name)
    if (environment[name] === undefined) values[name] = parsed[name]
  }
  return values
}

export function loadDevEnvironment() {
  Object.assign(process.env, readDevEnvironment())
}

// Bash 用 NUL 分隔读取键值，尾部空键表示成功；不 eval/source 用户文件。
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const values = readDevEnvironment(process.argv[2])
    for (const [name, value] of Object.entries(values)) {
      process.stdout.write(`${name}\0${value}\0`)
    }
    process.stdout.write('\0')
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
