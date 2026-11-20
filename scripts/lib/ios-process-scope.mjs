import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const key = 'MYBILL_PROCESS_SCOPE'
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const read = (file) => {
  if (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file)
    throw new Error('进程归属登记不能经链接。')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** 同一命令树共享私有归属范围；仅传递 PID/父登记，不记录命令参数或业务数据。 */
export function commandScope(root, env) {
  const inherited = env[key] ? JSON.parse(env[key]) : undefined
  let directory, nonce, parent = null, owned = false
  if (inherited) {
    directory = inherited.directory
    nonce = inherited.nonce
    parent = inherited.member
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || !uuid.test(nonce) || !uuid.test(parent) ||
      !/^ios-process-[A-Za-z0-9]+$/.test(path.basename(directory)) ||
      !path.dirname(directory).endsWith(path.sep + path.join('.local', 'ios', 'tmp', 'ai-agent')) ||
      fs.realpathSync(directory) !== directory)
      throw new Error('进程归属范围无效。')
    const stat = fs.lstatSync(directory), header = read(path.join(directory, 'scope.json'))
    if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) ||
      header.nonce !== nonce || !Number.isSafeInteger(header.owner) || header.owner <= 1)
      throw new Error('进程归属范围不匹配。')
    process.kill(header.owner, 0)
  } else {
    let base = fs.realpathSync(root)
    for (const part of ['.local', 'ios', 'tmp', 'ai-agent']) {
      base = path.join(base, part)
      if (!fs.existsSync(base)) fs.mkdirSync(base, { mode: 0o700 })
      if (!fs.lstatSync(base).isDirectory() || fs.realpathSync(base) !== base)
        throw new Error('进程归属父目录不能经链接。')
    }
    directory = fs.mkdtempSync(path.join(base, 'ios-process-'))
    nonce = randomUUID()
    owned = true
    try {
      fs.chmodSync(directory, 0o700)
      fs.writeFileSync(path.join(directory, 'scope.json'), JSON.stringify({ nonce, owner: process.pid }), { mode: 0o600 })
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true })
      throw error
    }
  }
  const member = randomUUID(), file = path.join(directory, member + '.json')
  let released = false
  const childDirectory = (id, create = false) => {
    const base = path.join(directory, '.children'), target = path.join(base, id)
    for (const current of [base, target]) {
      if (create) fs.mkdirSync(current, { recursive: true, mode: 0o700 })
      if (fs.existsSync(current) && (!fs.lstatSync(current).isDirectory() || fs.realpathSync(current) !== current))
        throw new Error('进程归属索引不能经链接。')
    }
    return target
  }
  const memberRead = (id) => {
    if (!uuid.test(id)) throw new Error('进程父登记无效。')
    const record = read(path.join(directory, id + '.json'))
    if (record.id !== id || record.nonce !== nonce ||
      (record.parent !== null && !uuid.test(record.parent)) ||
      !['reserved', 'running', 'done'].includes(record.state) ||
      (record.pid !== null && (!Number.isSafeInteger(record.pid) || record.pid <= 1)) ||
      (record.startedPid !== null && (!Number.isSafeInteger(record.startedPid) || record.startedPid <= 1)))
      throw new Error('进程归属登记不匹配。')
    return record
  }
  const blocked = (start = member) => {
    const seen = new Set()
    for (let id = start; id !== null;) {
      if (seen.has(id)) throw new Error('进程归属登记存在循环。')
      seen.add(id)
      const record = memberRead(id)
      if (record.state === 'done' || fs.existsSync(path.join(directory, '.closed-' + id))) return true
      id = record.parent
    }
    return false
  }
  const record = { id: member, parent, nonce, pid: null, startedPid: null, state: 'reserved' }
  const write = () => {
    const temporary = path.join(directory, '.tmp-' + randomUUID())
    try {
      fs.writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
      fs.renameSync(temporary, file)
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  }
  try {
    if (parent !== null && blocked(parent)) throw new Error('进程归属范围已关闭，拒绝启动新任务。')
    write()
    if (parent !== null)
      fs.writeFileSync(path.join(childDirectory(parent, true), member), '', { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (owned) fs.rmSync(directory, { recursive: true, force: true })
    throw error
  }
  return {
    inherited: Boolean(inherited),
    env: { ...env, [key]: JSON.stringify({ directory, nonce, member }) },
    bind(pid) {
      if (released || record.state !== 'reserved') throw new Error('进程登记已绑定或关闭。')
      record.pid = pid ?? null
      record.startedPid = pid ?? null
      record.state = 'running'
      write()
    },
    blocked,
    seal() {
      const marker = path.join(directory, '.closed-' + member)
      try {
        fs.writeFileSync(marker, '', { flag: 'wx', mode: 0o600 })
      } catch (error) {
        if (error.code !== 'EEXIST' || !fs.lstatSync(marker).isFile() || fs.realpathSync(marker) !== marker)
          throw error
      }
    },
    groups() {
      // 只遍历当前分支的活动索引；已完成叶子及时摘除，不扫描同轮其他测试的历史登记。
      const queue = [member], groups = new Set()
      const seen = new Set()
      for (let i = 0; i < queue.length; i++) {
        if (seen.has(queue[i])) throw new Error('进程归属登记存在循环。')
        seen.add(queue[i])
        const r = memberRead(queue[i]), children = childDirectory(r.id)
        if (r.pid !== null) groups.add(r.pid)
        for (const id of fs.existsSync(children) ? fs.readdirSync(children) : []) {
          if (memberRead(id).parent !== r.id) throw new Error('进程归属索引不匹配。')
          queue.push(id)
        }
      }
      return groups
    },
    finish(error) {
      if (released) return
      released = true
      if (!error) record.pid = null
      record.state = 'done'
      write()
      for (let current = memberRead(member); current.parent !== null && current.state === 'done' && current.pid === null;) {
        const children = childDirectory(current.id)
        if (fs.existsSync(children) && fs.readdirSync(children).length) break
        fs.rmSync(path.join(childDirectory(current.parent), current.id), { force: true })
        current = memberRead(current.parent)
      }
      if (owned && !error) fs.rmSync(directory, { recursive: true, force: true })
    }
  }
}
