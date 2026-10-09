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
