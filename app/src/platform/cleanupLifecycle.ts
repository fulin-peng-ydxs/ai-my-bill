import { reactive, watch } from 'vue'
import { CleanupService } from '../data/entries/cleanupService'
import { appDatabase } from '../data/appDatabase'
import { useBootstrapStore } from '../stores/bootstrap'
import { mutateEntry } from '../api/localEntries'
import { ledgerFiles } from './ledgerFiles'

export const cleanupNotice = reactive({ open: false, message: '' })
const session = crypto.randomUUID()
const service = new CleanupService(appDatabase, () => ({ wall: Date.now(), monotonic: performance.now(), session }))
/** 原生/DOM 前后台事件合并为一个前台轮次；不轮询、不在失败的本轮重试。 */
export function installCleanupLifecycle() {
  let foreground = !document.hidden
  let running: Promise<void> | undefined
  let controller: AbortController | undefined
  let pendingForeground = false
  const bootstrap = useBootstrapStore()
  const run = () => {
    // 初始化迟到、原生与 DOM 事件先后到达均消费同一前台资格。
    if (!foreground || document.hidden || bootstrap.status !== 'ready') {
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
        cleanupNotice.message = result.status === 'deferred' ? `到期清理已延期：${result.reason}。`
          : result.status === 'failed' || result.status === 'cancelled' ? result.reason! : ''
        cleanupNotice.open = Boolean(cleanupNotice.message)
      } catch {
        if (bootstrap.datasetId === dataset) {
          cleanupNotice.message = '到期清理暂未完成，后续回到前台时重新检查。'
          cleanupNotice.open = true
        }
      } finally {
        running = undefined
        if (pendingForeground && foreground) {
          pendingForeground = false
          run()
        }
      }
    })()
  }
  const activate = () => {
    // 原生激活可早于 DOM 可见；由随后到达的可见事件启动，不漏跑也不重复。
    if (!foreground && !document.hidden) {
      foreground = true
      run()
    }
  }
  const deactivate = () => {
    foreground = false
    controller?.abort()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      deactivate()
    } else {
      activate()
    }
  })
  void ledgerFiles.addListener('background', deactivate)
  void ledgerFiles.addListener('foreground', activate)
  watch(() => [bootstrap.status, bootstrap.datasetId], () => {
    if (bootstrap.status === 'ready') {
      cleanupNotice.open = false
      run()
    } else {
      controller?.abort()
    }
  })
  run()
}
