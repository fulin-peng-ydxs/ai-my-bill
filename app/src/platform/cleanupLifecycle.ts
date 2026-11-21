import { reactive, watch } from 'vue'
import { CleanupService } from '../data/entries/cleanupService'
import { appDatabase } from '../data/appDatabase'
import { useBootstrapStore } from '../stores/bootstrap'
import { mutateEntry } from '../api/localEntries'
import { ledgerFiles } from './ledgerFiles'
import { normalizeRequestError, type RequestError } from '../api/errors'

export const cleanupNotice = reactive({ open: false, message: '', error: undefined as RequestError | undefined })
const session = crypto.randomUUID()
const service = new CleanupService(appDatabase, () => ({ wall: Date.now(), monotonic: performance.now(), session }))
/** 原生/DOM 前后台事件合并为一个前台轮次；不轮询、不在失败的本轮重试。 */
export function installCleanupLifecycle(afterForeground?: (signal: AbortSignal) => Promise<void>) {
  let domVisible = !document.hidden
  let nativeForeground: boolean | undefined
  let nativeEventsReady = false
  let nativeRevision = 0
  let foreground = false
  let running: Promise<void> | undefined
  let controller: AbortController | undefined
  let pendingForeground = false
  const bootstrap = useBootstrapStore()
  const run = () => {
    // 初始化迟到、原生与 DOM 事件先后到达均消费同一前台资格。
    if (!foreground || !domVisible || document.hidden || !nativeEventsReady || nativeForeground !== true || bootstrap.status !== 'ready') {
      return
    }
    if (running) {
      pendingForeground = true
      return
    }
    const dataset = bootstrap.datasetId
    pendingForeground = false
    controller = new AbortController()
    running = (async () => {
      try {
        const result = await mutateEntry(() => service.run(dataset, controller!.signal))
        if (bootstrap.datasetId !== dataset) {
          return
        }
        cleanupNotice.error = result.error ? normalizeRequestError(result.error) : undefined
        cleanupNotice.message = result.status === 'deferred' ? `到期清理已延期：${result.reason}。`
          : result.status === 'failed' || result.status === 'cancelled' ? result.reason! : ''
        cleanupNotice.open = Boolean(cleanupNotice.message)
      } catch (cause) {
        if (bootstrap.datasetId === dataset) {
          cleanupNotice.error = normalizeRequestError(cause)
          cleanupNotice.message = '到期清理暂未完成，后续回到前台时重新检查。'
          cleanupNotice.open = true
        }
      } finally {
        if (afterForeground && foreground && !controller!.signal.aborted && bootstrap.status === 'ready' && bootstrap.datasetId === dataset) {
          try { await afterForeground(controller!.signal) }
          catch (cause) {
            cleanupNotice.error = normalizeRequestError(cause)
            cleanupNotice.message = '前台数据维护未完成，请查看数据与安全后重试。'
            cleanupNotice.open = true
          }
        }
        running = undefined
        if (pendingForeground && foreground) {
          pendingForeground = false
          run()
        }
      }
    })()
  }
  const reconcile = () => {
    // 任一路变为不可执行都取消；实时复核 DOM，避免隐藏通知迟到时提前占用轮次。
    const eligible = domVisible && !document.hidden && nativeEventsReady && nativeForeground === true
    if (!eligible) {
      foreground = false
      controller?.abort()
    } else if (!foreground) {
      foreground = true
      run()
    }
  }
  const nativeChanged = (active: boolean) => {
    nativeRevision++
    nativeForeground = active
    reconcile()
  }
  document.addEventListener('visibilitychange', () => {
    domVisible = !document.hidden
    reconcile()
  })
  // 先完成两路原生订阅，再读当前状态，补齐 JS 启动前已经发生的生命周期事件。
  // 查询在途的新事件优先；状态未知或订阅失败时不猜测前台，也不轮询重试。
  void Promise.all([
    ledgerFiles.addListener('background', () => nativeChanged(false)),
    ledgerFiles.addListener('foreground', () => nativeChanged(true)),
  ]).then(async () => {
    nativeEventsReady = true
    const revision = nativeRevision
    try {
      const state = await ledgerFiles.getLifecycleState()
      if (revision === nativeRevision) {
        nativeForeground = state.active
        reconcile()
      }
    } catch (cause) {
      if (revision === nativeRevision) {
        cleanupNotice.error = normalizeRequestError(cause)
        cleanupNotice.message = '前后台状态暂不可用，已暂停到期清理；回到前台后重新检查。'
        cleanupNotice.open = true
      }
    }
  }).catch(cause => {
    cleanupNotice.error = normalizeRequestError(cause)
    cleanupNotice.message = '前后台监听暂不可用，已暂停到期清理；请重新打开 App。'
    cleanupNotice.open = true
  })
  watch(() => [bootstrap.status, bootstrap.datasetId], () => {
    if (bootstrap.status === 'ready') {
      cleanupNotice.open = false
      run()
    } else {
      controller?.abort()
    }
  })
}
