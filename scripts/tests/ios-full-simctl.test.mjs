import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { simctlOutput, simctlSync } from '../lib/ios-simctl-sync.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
test('完整原生入口与局部入口共用可信 simctl 解析，生命周期不重复执行 SDK 包装器且参数完整', t => {
  const source = fs.readFileSync(path.join(root, 'scripts/lib/ios-app-full.sh'), 'utf8')
  const adapter = source.split('# full-simctl-adapter:start')[1].split('# full-simctl-adapter:end')[0]
  assert.ok(source.indexOf('phase boot native-boot') < source.indexOf('const tool = await resolveSimctl'))
  assert.ok(source.indexOf('if [[ "${MODE}" == ios-build ]]') < source.indexOf('const tool = await resolveSimctl'))
  assert.doesNotMatch(source, /(?:execFileSync|spawnSync)\('xcrun', \['simctl'/)
  const dir = fs.mkdtempSync(path.join(root, '.local/ios/tmp/ai-agent/full-simctl-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const bin = path.join(dir, 'bin'), native = path.join(dir, 'native tool')
  fs.mkdirSync(bin)
  fs.writeFileSync(native, '#!/bin/sh\nprintf "native" >> "$CALLS"\nprintf "|%s" "$@" >> "$CALLS"\nprintf "\\n" >> "$CALLS"\n', { mode: 0o700 })
  fs.writeFileSync(path.join(bin, 'xcrun'), '#!/bin/sh\nprintf "sdk" >> "$CALLS"\nprintf "|%s" "$@" >> "$CALLS"\nprintf "\\n" >> "$CALLS"\n', { mode: 0o700 })
  for (const program of [native, 'xcrun']) {
    const calls = path.join(dir, program === native ? 'direct.log' : 'fallback.log')
    const result = spawnSync('bash', ['-s'], { input: adapter + '\nxcrun simctl launch "owned device" "com.mybill.offline"\nxcrun --sdk iphoneos --show-sdk-version\n',
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, CALLS: calls, MYBILL_FULL_SIMCTL_PROGRAM: program }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), [
      program === native ? 'native|launch|owned device|com.mybill.offline' : 'sdk|simctl|launch|owned device|com.mybill.offline',
      'sdk|--sdk|iphoneos|--show-sdk-version'
    ])
  }
})

test('同步模拟器查询、终止和卸载不等待后代管道，分离输出且保留真实失败', { timeout: 10000 }, t => {
  const dir = fs.mkdtempSync(path.join(root, '.local/ios/tmp/ai-agent/simctl-sync-'))
  const pids = path.join(dir, 'helpers'), tool = path.join(dir, 'tool')
  t.after(() => {
    try {
      if (fs.existsSync(pids)) for (const pid of fs.readFileSync(pids, 'utf8').trim().split('\n').filter(Boolean).map(Number))
        try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
  fs.writeFileSync(tool, `#!${process.execPath}
const fs=require('node:fs'), command=process.argv[2];
if(command==='fail'){console.error('controlled denied');process.exit(17)}
const child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'inherit'});
fs.appendFileSync(${JSON.stringify(pids)},String(child.pid)+'\\n');child.unref();
console.log(command==='get_app_container'?'/owned path/container':'done');console.error('diagnostic only');
process.exit(command==='terminate'?3:0);
`, { mode: 0o700 })
  const start = performance.now()
  assert.equal(simctlOutput(tool, [], ['get_app_container'], path.join(dir, 'query')), '/owned path/container')
  assert.equal(simctlOutput(tool, [], ['uninstall'], path.join(dir, 'uninstall')), 'done')
  const stopped = simctlSync(tool, [], ['terminate'], path.join(dir, 'stop'))
  assert.equal(stopped.status, 3)
  assert.equal(stopped.stderr, 'diagnostic only\n')
  assert.equal(fs.statSync(path.join(stopped.directory, 'stderr.log')).mode & 0o777, 0o600)
  assert.ok(performance.now() - start < 5000, '请求退出后不等待 30 秒后代关闭输出')
  assert.throws(() => simctlOutput(tool, [], ['fail'], path.join(dir, 'failure')), /exit=17.*\ncontrolled denied/)
})
