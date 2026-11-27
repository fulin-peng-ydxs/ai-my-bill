import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** Check controlled inputs, never ignored legacy data or another repository's services. */
export function assertRetiredInputs(root) {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean)
  const obsolete = files.filter(file => /^(?:web|server|deploy|contracts|\.mvn)\//.test(file) ||
    ['pom.xml', 'mvnw', 'mvnw.cmd', '.dockerignore', '.env.example'].includes(file) ||
    /^app\/src\/(?:api\/generated|stores\/(?:auth|session)|pwa)\//.test(file))
  if (obsolete.length) throw new Error('退役运行材料重新进入受控输入：' + obsolete.join(', '))
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts
  if (!scripts || Object.entries(scripts).some(([name, command]) =>
    /^(?:dev(?::|$)|check:(?:server|database|deployment|e2e)|contracts:|build:release|environment$|ops$|release$)/.test(name) ||
    /\b(?:java|javac|mvn|mvnw|docker|psql|pg_ctl)\b|--prefix\s+(?:web|server)\b/.test(command)))
    throw new Error('根命令仍包含旧端运行或发布入口。')
  const toolchain = path.join(root, 'scripts/toolchain.sh')
  if (fs.existsSync(toolchain) && /resolve_java|java_home|JAVA_HOME/.test(fs.readFileSync(toolchain, 'utf8')))
    throw new Error('工具链仍要求旧 Java 环境。')
  for (const file of files.filter(f => /^app\/src\/.*\.(?:ts|vue)$/.test(f) && !f.endsWith('.spec.ts'))) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    if (/generated\/schema|\/api\/v1\b|\bapiRequest\s*[(<]|navigator\.serviceWorker/.test(text))
      throw new Error('App 仍消费旧网络契约或发行入口：' + file)
  }
  return { status: 'passed', scope: 'controlled-inputs', files: files.length }
}
