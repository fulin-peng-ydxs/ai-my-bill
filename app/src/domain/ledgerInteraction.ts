const POINTER_MOVE_TOLERANCE = 8

/** 允许点按抖动；超过容差的移动取消长按与点击，任何滑动方向都不触发管理动作。 */
export function hasLedgerPointerMoved(startX: number, startY: number, endX: number, endY: number): boolean {
  return Math.hypot(endX - startX, endY - startY) >= POINTER_MOVE_TOLERANCE
}
