const CONTEXT_SWIPE_MIN_DISTANCE = 48
const HORIZONTAL_INTENT_RATIO = 1.2

/** 仅把方向明确且达到阈值的左滑识别为上下文操作，避免纵向滚动误触。 */
export function isLedgerContextSwipe(startX: number, startY: number, endX: number, endY: number): boolean {
  const horizontal = endX - startX
  const vertical = endY - startY
  return horizontal <= -CONTEXT_SWIPE_MIN_DISTANCE
    && Math.abs(horizontal) >= Math.abs(vertical) * HORIZONTAL_INTENT_RATIO
}
