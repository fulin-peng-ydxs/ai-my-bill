import { beforeEach, expect, it } from 'vitest'
import { clearLedgerScrollMemory, createLedgerScrollRestorer, ledgerScrollKey, readLedgerScroll, rememberLedgerScroll } from './ledgerNavigationMemory'
beforeEach(clearLedgerScrollMemory)
it('数据集/精确链路隔离，最多保留 100 个有效位置', () => {
  const key = ledgerScrollKey('a', '/ledger?q=old')
  rememberLedgerScroll(key, 420)
  expect(readLedgerScroll(key)).toBe(420)
  expect(readLedgerScroll(ledgerScrollKey('b', '/ledger?q=old'))).toBeUndefined()
  expect(readLedgerScroll(ledgerScrollKey('a', '/ledger?q=new'))).toBeUndefined()
  rememberLedgerScroll('', 1)
  rememberLedgerScroll(key, Number.NaN)
  for (let i = 0; i < 100; i++) rememberLedgerScroll(`a|${i}`, i)
  expect(readLedgerScroll(key)).toBeUndefined()
  clearLedgerScrollMemory()
  expect(readLedgerScroll('a|99')).toBeUndefined()
})
it('返回仅恢复一次；慢查询、离页或用户新滚动撤销旧恢复意图', () => {
  let key = 'a|one'
  let active = true
  let scroll = 0
  const restorer = createLedgerScrollRestorer({ key: () => key, active: () => active, read: () => scroll, write: top => { scroll = top } })
  const restore = restorer.prepare(420)
  expect(restore()).toBe(true)
  scroll = 500
  expect(restore()).toBe(false)
  expect(scroll).toBe(500)
  const moved = restorer.prepare(0)
  scroll = 501
  expect(moved()).toBe(false)
  const old = restorer.prepare(0)
  const latest = restorer.prepare(100)
  expect(old()).toBe(false)
  expect(latest()).toBe(true)
  const changed = restorer.prepare(0)
  key = 'b|two'
  expect(changed()).toBe(false)
  const hidden = restorer.prepare(0)
  active = false
  expect(hidden()).toBe(false)
  active = true
  const cancelled = restorer.prepare(0)
  restorer.cancel()
  expect(cancelled()).toBe(false)
})
