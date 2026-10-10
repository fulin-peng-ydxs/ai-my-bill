/** 原生 dialog 自动聚焦也可能匹配 focus-visible；用实际输入方式区分触摸与键盘。 */
export function installInputModality(): void {
  document.addEventListener('pointerdown', () => {
    document.documentElement.dataset.inputModality = 'pointer'
  }, { capture: true, passive: true })
  document.addEventListener('keydown', (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      document.documentElement.dataset.inputModality = 'keyboard'
    }
  }, true)
}
