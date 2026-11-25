import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { git } from './ios-local-delivery.mjs'
import { writeJson } from './ios-verification.mjs'

const managed = ['pre-commit', 'post-commit', 'pre-push']
const shellQuote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'"
const forwarding = target => '#!/bin/sh\nexec ' + shellQuote(target) + ' "$@"\n'
const privatePrefix = gitDirectory => path.join(gitDirectory, 'codex', 'hooks-')

export function managedHookOrigin(root, gitDirectory, directory) {
  const absolute = path.resolve(root, directory)
  const real = fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute
  return real === path.join(root, '.githooks') || real.startsWith(privatePrefix(gitDirectory))
}

/** Publish a complete hook generation, preserving all executable original hooks and their original argv[0]. */
export function installLocalHooks(root, gitDirectory, configFile, config, { activate, write = fs.writeFileSync } = {}) {
  const origin = config.previousHooks && path.resolve(root, config.previousHooks)
  if (origin && managedHookOrigin(root, gitDirectory, origin)) throw new Error('原 hook 指向受管目录自身，拒绝递归。')
  const desired = {}
  if (origin && fs.existsSync(origin)) {
    for (const name of fs.readdirSync(origin).sort()) {
      if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name) || managed.includes(name)) continue
      const file = path.join(origin, name)
      if (!fs.statSync(file).isFile()) continue
      try { fs.accessSync(file, fs.constants.X_OK) } catch { continue }
      // exec the original pathname, rather than a symlink: hooks may locate resources using dirname "$0".
      desired[name] = forwarding(file)
    }
  }
  for (const name of managed) desired[name] = forwarding(path.join(root, '.githooks', name))
  let directory = config.hooksPath
  if (directory) {
    if (!path.isAbsolute(directory) || !directory.startsWith(privatePrefix(gitDirectory)) || fs.realpathSync(directory) !== directory)
      throw new Error('受管 hook 目录归属无效。')
    const names = fs.readdirSync(directory).sort(), expected = Object.keys(config.hooksState ?? {}).sort()
    if (JSON.stringify(names) !== JSON.stringify(expected) || names.some(name => {
      const file = path.join(directory, name), stat = fs.lstatSync(file)
      return !stat.isFile() || !(stat.mode & 0o111) || fs.readFileSync(file, 'utf8') !== config.hooksState[name]
    })) throw new Error('受管 hook 存在外部改动；保留现场，不覆盖或删除。')
  }
  const activeResult = (() => { try { return git(root, 'config', '--path', '--get', 'core.hooksPath') } catch (error) { if (error.status !== 1) throw error; return null } })()
  const active = activeResult ? path.resolve(root, activeResult) : null
  const allowed = [null, origin, path.join(root, '.githooks'), config.hooksPath, config.hookActivation?.from]
  if (!allowed.includes(active)) throw new Error('当前 hook 来源已变化，先核对，不覆盖其他配置。')
  const unchanged = directory && JSON.stringify(config.hooksState) === JSON.stringify(desired)
  let intentPublished = false, created = false
  try {
    if (!unchanged) {
      directory = privatePrefix(gitDirectory) + randomUUID()
      fs.mkdirSync(directory, { mode: 0o700 }); created = true
      for (const [name, body] of Object.entries(desired)) write(path.join(directory, name), body, { mode: 0o700, flag: 'wx' })
    }
    const next = { ...config, hooksPath: directory, hooksState: desired, hookActivation: { from: active, to: directory } }
    writeJson(configFile, next); intentPublished = true
    // Persist intent before switching Git; a failed/interrupted activation can resume without rebuilding the generation.
    if (activate) activate(directory)
    else git(root, 'config', '--local', 'core.hooksPath', directory)
    delete next.hookActivation
    writeJson(configFile, next)
    return { status: 'passed', reused: Boolean(unchanged), directory, forwarded: Object.keys(desired).filter(n => !managed.includes(n)) }
  } finally {
    if (created && !intentPublished) fs.rmSync(directory, { recursive: true })
    // Published old generations may still be used by an in-flight Git process; do not delete them on reinstall.
  }
}
