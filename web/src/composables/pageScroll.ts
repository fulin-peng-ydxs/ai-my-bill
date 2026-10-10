/** 活动页正文是唯一主滚动区域；登录页等外壳外页面仍使用窗口。 */
function scrollRegion(): globalThis.HTMLElement | null {
  if (typeof document === 'undefined') return null
  const page = document.querySelector<globalThis.HTMLElement>('.shell-content > .cached-page')
  return page?.querySelector<globalThis.HTMLElement>('[data-page-scroll]') ?? page ?? null
}

export function pageScrollTop(): number {
  return scrollRegion()?.scrollTop ?? globalThis.scrollY ?? 0
}

export function scrollPageTo(top: number): void {
  const region = scrollRegion()
  if (region) region.scrollTo({ top })
  else globalThis.scrollTo({ top })
}

/** iOS 收起键盘后可能保留超出新滚动范围的位置，只纠正越界，不清除正文记忆。 */
export function restorePageScrollBounds(workspace: globalThis.HTMLElement | undefined): void {
  const region = workspace?.querySelector<globalThis.HTMLElement>('[data-page-scroll]')
  if (!region || region.clientHeight <= 0) return
  const maximum = Math.max(0, region.scrollHeight - region.clientHeight)
  if (region.scrollTop > maximum) region.scrollTo({ top: maximum, behavior: 'instant' })
}

/** 键盘调整外壳后只滚动所属正文，避免 scrollIntoView 再次平移 iOS 整个视口。 */
export function revealFocusedPageControl(workspace: globalThis.HTMLElement | undefined): void {
  const control = globalThis.document.activeElement
  const region = workspace?.querySelector<globalThis.HTMLElement>('[data-page-scroll]')
  if (!control || !region?.contains(control) || !control.matches('input, textarea, select')) return
  const field = control.getBoundingClientRect()
  const visible = region.getBoundingClientRect()
  if (visible.height <= 0) return
  const delta = field.bottom - field.top > visible.height ? field.top - visible.top
    : field.bottom > visible.bottom ? field.bottom - visible.bottom
    : field.top < visible.top ? field.top - visible.top : 0
  if (delta) region.scrollBy({ top: delta, behavior: 'instant' })
}
