import fs from 'node:fs'
import { spawn } from 'node:child_process'

// 补偿命令先等待父进程登记其进程组；父进程提前退出则管道 EOF，实际工具不会启动。
const control = fs.createReadStream(null, { fd: 3, autoClose: true })
let message = ''
for await (const data of control) {
  message += data.toString()
  if (message.length > 16) break
}
if (message !== 'GO\n') process.exitCode = 1
else {
  const [program, ...args] = process.argv.slice(2)
  const child = spawn(program, args, { stdio: 'inherit', detached: false })
  child.once('error', (error) => { console.error(error.message); process.exitCode = 1 })
  child.once('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1 })
}
