// Exercise strict defaults, immutable candidate binding and unrelated finding rejection without network.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const temporary = mkdtempSync(join(tmpdir(), 'my-bill-security-exception-'))
try {
  const files = ['lock.json', 'dependencies.txt', 'plugins.txt', 'approval.json', 'mock.mjs'].map(name => join(temporary, name))
  writeFileSync(files[0], '{"packages":{}}')
  writeFileSync(files[1], ' org.springframework:spring-webmvc:jar:6.2.19:compile\n')
  writeFileSync(files[2], '')
  writeFileSync(files[4], `globalThis.fetch = async () => ({ok:true,json:async()=>({results:[{vulns:[{id:'GHSA-pc63-qcmh-9cmg'},...(process.env.INJECT_SECOND ? [{id:'GHSA-j9f9-w8pj-32f8'}] : []),...(process.env.INJECT_UNRELATED ? [{id:'GHSA-unrelated'}] : [])]}]})})`)
  const approval = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    target: 'intranet-main', host: '10.100.101.104',
    dependency: 'Maven:org.springframework:spring-webmvc:6.2.19', id: 'GHSA-pc63-qcmh-9cmg',
    approvedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), reason: 'fixture approval',
  }
  function run(record, unrelated = false, second = false) {
    writeFileSync(files[3], JSON.stringify(record ?? {}))
    const environment = { ...process.env }
    delete environment.MY_BILL_SECURITY_EXCEPTION_FILE
    delete environment.INJECT_UNRELATED
    delete environment.INJECT_SECOND
    if (record) environment.MY_BILL_SECURITY_EXCEPTION_FILE = files[3]
    if (unrelated) environment.INJECT_UNRELATED = '1'
    if (second) environment.INJECT_SECOND = '1'
    return spawnSync(process.execPath, ['--import', files[4], 'scripts/check-osv.mjs', ...files.slice(0, 3), 'server/pom.xml'], {env:environment,encoding:'utf8'})
  }
  assert.equal(run(null).status, 1)
  const accepted = run(approval)
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.match(accepted.stderr, /ACCEPTED RISK/)
  assert.match(accepted.stdout, /not a zero-vulnerability result/)
  assert.equal(run(approval, true).status, 1)
  assert.equal(run(approval, false, true).status, 1)
  const { id, ...scope } = approval
  const multiple = { ...scope, ids: [id, 'GHSA-j9f9-w8pj-32f8'] }
  assert.equal(run(multiple, false, true).status, 0)
  assert.equal(run(multiple, true, true).status, 1)
  for (const ids of [[], [id, id], ['GHSA-unrelated'], id, null]) {
    assert.notEqual(run({ ...scope, ids }, false, true).status, 0)
  }
  assert.notEqual(run({ ...multiple, id }, false, true).status, 0)
  for (const change of [{commit:'0'.repeat(40)}, {target:'different'}, {host:'127.0.0.1'}, {dependency:'Maven:org.springframework:spring-webmvc:6.2.18'}, {id:'different'}, {expiresAt:new Date(0).toISOString()}, {expiresAt:new Date(Date.now()+8*86400000).toISOString()}, {approvedAt:new Date(Date.now()+3600000).toISOString()}, {unexpected:true}]) {
    assert.notEqual(run({...approval,...change}).status, 0, JSON.stringify(change))
  }
  console.log('Security exception scope/default/expiry/unrelated finding checks passed.')
} finally { rmSync(temporary, { recursive: true, force: true }) }
