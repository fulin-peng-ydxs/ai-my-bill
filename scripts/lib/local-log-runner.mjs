import { spawn } from 'node:child_process'
import { mkdirSync, openSync, closeSync, writeSync, readdirSync, lstatSync, unlinkSync, readFileSync, writeFileSync, rmdirSync } from 'node:fs'
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
if (kind === 'backend') {
  integer('MY_BILL_APP_LOG_HISTORY', 7, 365)
  const dataSize = (name, fallback, maximum) => {
    const value = process.env[name] ?? fallback
    const match = /^([1-9]\d{0,6})(KB|MB|GB)$/.exec(value)
    const size = match && Number(match[1]) * ({ KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[match[2]])
    if (!size || size > maximum) throw new Error(`Invalid ${name}`)
    return size
  }
  const appFile = dataSize('MY_BILL_APP_LOG_FILE_SIZE', '10MB', 100 * 1024 ** 2)
  const appTotal = dataSize('MY_BILL_APP_LOG_TOTAL_SIZE', '200MB', 2 * 1024 ** 3)
  if (appFile > appTotal) throw new Error('Application log file limit exceeds total limit')
  for (const key of ['MY_BILL_LOG_LEVEL', 'MY_BILL_APP_LOG_LEVEL']) {
    if (process.env[key] && !['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'OFF'].includes(process.env[key])) throw new Error(`Invalid ${key}`)
  }
}
process.umask(0o077)
const directory = resolve(process.env.MY_BILL_LOCAL_LOG_ROOT ?? '.local/web/logs', kind)
mkdirSync(directory, { recursive: true, mode: 0o700 })
if (lstatSync(directory).isSymbolicLink()) throw new Error('Log directory must not be a symlink')
// A shared application.log must have only one writer; reject concurrent local launches before spawning.
const lock = join(directory, '.writer-lock')
try { mkdirSync(lock, { mode: 0o700 }) } catch (error) {
  if (error.code !== 'EEXIST') throw error
  if (lstatSync(lock).isSymbolicLink()) throw new Error('Unsafe log writer lock')
  const ownerFile = join(lock, 'pid')
  if (lstatSync(ownerFile).isSymbolicLink()) throw new Error('Unsafe log writer PID')
  const owner = readFileSync(ownerFile, 'utf8').trim()
  if (!/^[1-9]\d*$/.test(owner)) throw new Error('Invalid log writer PID')
  try { process.kill(Number(owner), 0); throw new Error(`${kind} already has a local log writer`) }
  catch (failure) {
    if (failure.code !== 'ESRCH') throw failure
    unlinkSync(ownerFile); rmdirSync(lock); mkdirSync(lock, { mode: 0o700 })
  }
}
writeFileSync(join(lock, 'pid'), String(process.pid), { flag: 'wx', mode: 0o600 })
let child, finished = false
process.on('exit', () => {
  if (!finished && child?.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
  try { unlinkSync(join(lock, 'pid')); rmdirSync(lock) } catch {}
})
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
child = spawn(command, args, { detached: true, stdio: ['inherit', 'pipe', 'pipe'] })
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
child.on('exit', () => stop('SIGTERM'))
child.on('error', error => { record(Buffer.from(`启动失败：${error.message}\n`), process.stderr) })
child.on('close', (code, signal) => {
  finished = true
  // Kill any orphan descendants left by a launcher that exited early.
  try { process.kill(-child.pid, 'SIGKILL') } catch {}
  closeSync(fd); prune()
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
})
