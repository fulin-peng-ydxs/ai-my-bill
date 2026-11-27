/** Expected signals emitted by dictionary-touch.py and ios_data_management.py after real SQL/file checks.
 * This is consumption policy, not execution input. Never accept a different scenario's success marker.
 */
export function uiReadbackMarkers(selected) {
  const fixture = selected.fixture
  const families = {
    personal: 'PERSONAL_TOUCH_SQLITE_VERIFIED', lifecycle: 'LIFECYCLE_TOUCH_SQLITE_VERIFIED',
    query: 'LEDGER_QUERY_TOUCH_SQLITE_VERIFIED', report: 'REPORT_TOUCH_SQLITE_VERIFIED',
    data: 'DATA_MANAGEMENT_SQLITE_FILES_VERIFIED', interaction: 'IOS_INTERACTION_SQLITE_VERIFIED'
  }
  const group = /^(personal|lifecycle|query|report|data|interaction)-(\d+(?:,\d+)*)$/.exec(fixture ?? '')
  if (group) return [families[group[1]] + ' cases=' + group[2]]
  const entry = fixture === 'entry-cycle'
  const income = ['income-note', 'income-note-after-save'].includes(fixture)
  const number = entry || income ? 16 : /^(?:[0-9]|1[0-6])$/.test(fixture ?? '') ? Number(fixture) : undefined
  if (number === undefined) throw new Error('该 UI 范围没有已登记的 SQLite 回读协议。')
  return ['DICTIONARY_DEBUG_SQLITE_VERIFIED case=' + number,
    ...(number >= 15 ? ['ENTRY_TOUCH_SQLITE_VERIFIED case=' + number] : []),
    ...(entry ? ['ENTRY_TOUCH_SQLITE_VERIFIED case=15'] : [])]
}

/** SQL 草稿回读不证明键盘/旋转/日期已操作，三例还须各自的实际触摸完成信号。 */
export function assertUiInteractionLog(selected, text) {
  if (!selected.fixture?.startsWith('interaction-')) return
  const markers = {
    'test51IosKeyboardNavigation': 'IOS_KEYBOARD_NAVIGATION_VERIFIED',
    'test52IosCandidatesAndDate': 'IOS_CANDIDATE_DATE_VERIFIED',
    'test53IosLandscapeCandidates': 'IOS_LANDSCAPE_CANDIDATE_VERIFIED'
  }
  const expected = selected.cases.map(id => markers[id.split('/').at(-1)])
  const observed = text.split(/\r?\n/).filter(line => /^IOS_\w+_VERIFIED$/.test(line))
  if (!expected.length || expected.some(value => !value) || JSON.stringify(observed) !== JSON.stringify(expected))
    throw new Error('iOS 交互触摸完成信号与实际用例不符。')
}

export function assertUiReadback(selected, text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024)
    throw new Error('UI 回读日志无效或过大。')
  const expected = uiReadbackMarkers(selected)
  const observed = text.split(/\r?\n/).filter(line => /^[A-Z_]+SQLITE[A-Z_]*VERIFIED(?: |$)/.test(line))
  if (JSON.stringify(observed) !== JSON.stringify(expected))
    throw new Error('UI 回读标记与实际场景/用例范围不符。')
}
