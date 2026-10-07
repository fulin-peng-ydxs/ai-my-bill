interface DropdownBounds { left: number, top: number, right: number, bottom: number, width: number }

/** 使用可见视口与真正可见的保存栏边界，候选总高度始终有界。 */
export function dropdownLayout(anchor: DropdownBounds, viewport: DropdownBounds, contentHeight: number,
  mobile: boolean, savebar?: DropdownBounds) {
  const gap = 8
  const cap = mobile ? 240 : 320
  // 短字段可并排，候选面板仍为搜索、取消和长名称保留可读宽度。
  const width = Math.min(Math.max(anchor.width, mobile ? 260 : anchor.width), Math.max(0, viewport.width - gap * 2))
  const left = Math.max(viewport.left + gap, Math.min(anchor.left, viewport.right - width - gap))
  // 键盘展开/页面平移期间锚点可能短暂离开视口，不在键盘下面显示不可操作的候选。
  if (anchor.top >= viewport.bottom || anchor.bottom <= viewport.top) {
    return { left, top: anchor.bottom + 4, width, maxHeight: 0 }
  }
  // 已滚离视口、在输入框上方或非覆盖式保存栏不能吞掉全部候选空间。
  const bottom = savebar && savebar.top > anchor.bottom && savebar.top < viewport.bottom
    && savebar.bottom > viewport.top ? savebar.top : viewport.bottom
  const below = Math.max(0, bottom - anchor.bottom - gap - 4)
  const above = Math.max(0, anchor.top - viewport.top - gap - 4)
  const desired = Math.min(cap, contentHeight)
  const opensAbove = below < Math.min(132, desired) && above > below
  const maxHeight = Math.min(cap, opensAbove ? above : below)
  const top = opensAbove ? anchor.top - 4 - Math.min(desired, maxHeight) : anchor.bottom + 4
  return { left, top, width, maxHeight }
}
