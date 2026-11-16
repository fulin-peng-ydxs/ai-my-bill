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
