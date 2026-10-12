interface DropdownBounds { left: number, top: number, right: number, bottom: number, width: number }

/** 使用可见视口与真正可见的保存栏边界，候选总高度始终有界。 */
export function dropdownLayout(anchor: DropdownBounds, viewport: DropdownBounds, contentHeight: number,
  mobile: boolean, savebar?: DropdownBounds, scrollTop?: number) {
  const gap = 8
  const anchorGap = 4
  const cap = mobile ? 240 : 320
  // 短字段可并排，候选面板仍为搜索、取消和长名称保留可读宽度。
  const width = Math.min(Math.max(anchor.width, mobile ? 260 : anchor.width), Math.max(0, viewport.width - gap * 2))
  const left = Math.max(viewport.left + gap, Math.min(anchor.left, viewport.right - width - gap))
  // 键盘展开/页面平移期间锚点可能短暂离开视口，不在键盘下面显示不可操作的候选。
  if (anchor.top >= viewport.bottom || anchor.bottom <= viewport.top) {
    return { left, top: anchor.bottom + 4, width, maxHeight: 0, revealHeight: 0, revealScroll: 0 }
  }
  // 已滚离视口、在输入框上方或非覆盖式保存栏不能吞掉全部候选空间。
  const bottom = savebar && savebar.top > anchor.bottom && savebar.top < viewport.bottom
    && savebar.bottom > viewport.top ? savebar.top : viewport.bottom
  // 垂直边界用真实正文边缘；额外虚构留白会要求超过实际溢出的滚动量，导致候选反复收缩。
  const below = Math.max(0, bottom - anchor.bottom - anchorGap)
  const above = Math.max(0, anchor.top - viewport.top - anchorGap)
  const minimum = Math.min(132, contentHeight)
  const revealHeight = Math.min(minimum,
    Math.max(0, bottom - viewport.top - (anchor.bottom - anchor.top) - anchorGap))
  // 字段位于正文底部时可能没有更多可滚动内容；优先使用真实可见的上方空间。
  // 正文已在顶部且上方不足时，向上列表不能继续让位；改在下方产生实际滚动范围。
  const canRevealAbove = scrollTop === undefined || above + scrollTop >= revealHeight
  const direction = below < minimum && above > below && canRevealAbove ? 'above' : 'below'
  const maxHeight = Math.min(cap, direction === 'above' ? above : below)
  // 搜索栏不能占满整个候选区；向上展开也需把字段向下带回，而非只修正向下溢出。
  const revealScroll = direction === 'above' ? Math.min(0, maxHeight - revealHeight)
    : Math.max(0, revealHeight - maxHeight)
  const top = direction === 'above' ? anchor.top - Math.min(contentHeight + 2, maxHeight) - 4 : anchor.bottom + 4
  return { left, top, width, maxHeight, revealHeight, revealScroll, direction }
}
