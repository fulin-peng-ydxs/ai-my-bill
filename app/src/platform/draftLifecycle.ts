import { ledgerFiles } from './ledgerFiles'

const writers = new Set<() => Promise<void>>()
export function registerDraftFlush(write: () => Promise<void>) {
  writers.add(write)
  return () => writers.delete(write)
}
export async function flushDrafts() {
  await Promise.all([...writers].map(write => write()))
}
/** 页面隐藏与原生挂起都消费同一批落盘入口；原生提供有界的后台完成窗口。 */
export function installDraftLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      void flushDrafts()
    }
  })
  window.addEventListener('pagehide', () => { void flushDrafts() })
  void ledgerFiles.addListener('background', async () => {
    try {
      await flushDrafts()
    } finally {
      await ledgerFiles.finishBackground()
    }
  })
}
