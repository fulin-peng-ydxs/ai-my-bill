import fs from 'node:fs'
import { spawn } from 'node:child_process'

// 换行是放行帧边界；不能等待父进程关闭双工流才启动，半帧/无帧 EOF 均拒绝。
const trace=(stage,details={})=>fs.writeSync(4,JSON.stringify({stage,pid:process.pid,uid:process.getuid(),euid:process.geteuid(),...details})+'\n')
trace('waiting')
const control = fs.createReadStream(null, { fd: 3, autoClose: true })
let message = ''
for await (const data of control) {
  message += data.toString()
  trace('frame',{bytes:message.length})
  if (message.length > 16 || message.includes('\n')) break
}
if (message !== 'GO\n') process.exitCode = 1
else {
  trace('starting')
  const [program, ...args] = process.argv.slice(2)
  const child = spawn(program, args, { stdio: 'inherit', detached: false })
  trace('started',{toolPid:child.pid})
  child.once('error', (error) => { console.error(error.message); process.exitCode = 1 })
  child.once('exit', (code, signal) => { trace('exited',{code,signal});process.exitCode = signal ? 1 : code ?? 1 })
}
