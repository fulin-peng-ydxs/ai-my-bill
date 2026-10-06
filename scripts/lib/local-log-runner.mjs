import { spawn } from 'node:child_process'
import { mkdirSync, openSync, closeSync, writeSync, readdirSync, lstatSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

// One process group per invocation: terminal interrupts and dev.sh cleanup reach Maven/npm descendants.
const [kind, command, ...args] = process.argv.slice(2)
if (!['backend', 'frontend', 'postgres'].includes(kind) || !command) throw new Error('Invalid local log invocation')
const integer = (name, fallback, maximum) => {
  const value = process.env[name] ?? String(fallback)
  if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) throw new Error(`Invalid ${name}`)
  return Number(value)
}
const days = integer('MY_BILL_LOCAL_LOG_DAYS', 7, 365)
const budget = integer('MY_BILL_LOCAL_LOG_TOTAL_MB', 100, 2048) * 1024 * 1024
const chunkLimit = integer('MY_BILL_LOCAL_LOG_FILE_MB', 10, 100) * 1024 * 1024
if (chunkLimit > budget) throw new Error('Local log file limit exceeds total limit')
process.umask(0o077)
const directory = resolve(process.env.MY_BILL_LOCAL_LOG_ROOT ?? '.local/logs', kind)
mkdirSync(directory, { recursive: true, mode: 0o700 })
if (lstatSync(directory).isSymbolicLink()) throw new Error('Log directory must not be a symlink')
const prefix = kind === 'backend' ? 'launcher' : kind === 'postgres' ? 'postgres' : 'dev'
const batch = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`
const pattern = /^(launcher|dev|postgres)\.\d{4}-.*-\d+\.\d+\.log$/
let fd, activePath, size = 0, segment = 0
function prune() {
  const files = readdirSync(directory).filter(name => pattern.test(name))
    .map(name => ({ path: join(directory, name), stat: lstatSync(join(directory, name)) }))
    .filter(file => file.stat.isFile()).sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
  let total = files.reduce((sum, file) => sum + file.stat.size, 0)
  for (const file of files) {
    if (file.path === activePath) continue
    if (file.stat.mtimeMs < Date.now() - days * 86400000 || total > budget) {
      unlinkSync(file.path); total -= file.stat.size
    }
  }
}
function next() {
  if (fd !== undefined) closeSync(fd)
  activePath = join(directory, `${prefix}.${batch}.${segment++}.log`)
  fd = openSync(activePath, 'wx', 0o600); size = 0; prune()
}
next()
console.log(`日志：${directory}`)
const child = spawn(command, args, { detached: true, stdio: ['inherit', 'pipe', 'pipe'] })
let stopping = false
function stop(signal) {
  if (stopping) return
  stopping = true
  try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 5000)
  timer.unref()
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(signal))
function record(data, output, source) {
  if (!output.write(data) && source) { source.pause(); output.once("drain", () => source.resume()) }
  let offset = 0
  while (offset < data.length) {
    if (size === chunkLimit) next()
    const length = Math.min(data.length - offset, chunkLimit - size)
    writeSync(fd, data, offset, length); size += length; offset += length
  }
  prune()
}
child.stdout.on('data', data => record(data, process.stdout, child.stdout))
child.stderr.on('data', data => record(data, process.stderr, child.stderr))
child.on('error', error => { record(Buffer.from(`启动失败：${error.message}\n`), process.stderr) })
child.on('close', (code, signal) => {
  // Kill any orphan descendants left by a launcher that exited early.
  try { process.kill(-child.pid, 'SIGTERM') } catch {}
  closeSync(fd); prune()
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
})
