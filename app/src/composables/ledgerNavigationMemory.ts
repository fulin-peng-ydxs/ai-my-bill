const MAX_POSITIONS = 100
const positions = new Map<string, number>()

export function ledgerScrollKey(datasetId: string, routeKey: string): string {
  return `${datasetId}|${routeKey}`
}

/** 只在当前进程内按数据集记忆明细滚动，不写入持久化存储。 */
export function rememberLedgerScroll(routeKey: string, position: number): void {
  if (!routeKey || !Number.isFinite(position) || position < 0) return
  positions.delete(routeKey)
  positions.set(routeKey, position)
  while (positions.size > MAX_POSITIONS) {
    const oldest = positions.keys().next().value as string | undefined
    if (!oldest) break
    positions.delete(oldest)
  }
}

export function readLedgerScroll(routeKey: string): number | undefined {
  return positions.get(routeKey)
}

export function clearLedgerScrollMemory(): void {
  positions.clear()
}

/** 查询返回只恢复一次；后续查询、离页或用户的新滚动都撤销旧恢复意图。 */
export function createLedgerScrollRestorer(context: { key: () => string; active: () => boolean; read: () => number; write: (top: number) => void }) {
  let generation = 0
  return {
    cancel: () => { generation++ },
    prepare: (target: number) => {
      const current = ++generation
      const key = context.key()
      const before = context.read()
      let used = false
      return () => {
        if (used || current !== generation || !context.active() || context.key() !== key || context.read() !== before) return false
        used = true
        context.write(target)
        return true
      }
    },
  }
}
