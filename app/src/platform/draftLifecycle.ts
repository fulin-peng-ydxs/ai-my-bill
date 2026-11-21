import { ledgerFiles } from './ledgerFiles'

const writers = new Set<(strict?: boolean) => Promise<void>>()
export function registerDraftFlush(write: (strict?: boolean) => Promise<void>) {
  writers.add(write)
  return () => writers.delete(write)
}
export async function flushDrafts(strict = false) {
  await Promise.all([...writers].map(write => write(strict)))
}
/** 页面隐藏与原生挂起都消费同一批落盘入口；原生提供有界的后台完成窗口。 */
export function installDraftLifecycle() {
  let lastNativeGeneration = 0
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      void flushDrafts()
    }
  })
  window.addEventListener('pagehide', () => { void flushDrafts() })
  void ledgerFiles.addListener('background', async event => {
    const generation = event?.generation
    // 原生按真实状态迁移递增代次；重复/迟到通知不能在失败结束后额外开一轮重试。
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation <= lastNativeGeneration) {
      return
    }
    lastNativeGeneration = generation
    try {
      await flushDrafts()
    } finally {
      await ledgerFiles.finishBackground({ generation })
    }
  })
}
