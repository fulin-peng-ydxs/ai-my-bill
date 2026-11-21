import { computed, nextTick, onDeactivated, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { EntryType } from '../domain/preferences'
import { DRAFT_DEBOUNCE_MS, sanitizeDraft } from '../domain/ledgerDraft'
import { DraftService } from '../data/personal/draftService'
import { appDatabase } from '../data/appDatabase'
import { localOperation } from '../data/localOperation'
import { useBootstrapStore } from '../stores/bootstrap'
import { registerDraftFlush } from '../platform/draftLifecycle'
import { LocalError } from '../domain/localError'
import { registerUnsavedChanges, notifyUnsavedChangesChanged } from './unsavedChanges'

const service = new DraftService(appDatabase)
/** 每个表单独占编辑状态，250ms 合并输入；离开缓存页/切后台时立即提交最新快照。 */
export function useLedgerDraft(type: Ref<EntryType>, enabled?: Ref<boolean>) {
  const bootstrap = useBootstrapStore()
  const dataset = bootstrap.datasetId
  const data = ref<Record<string, string>>({})
  const restored = ref(false)
  const storageError = ref<string>()
  const editRevision = ref(0)
  const active = computed(() => (enabled?.value ?? true) && bootstrap.datasetId === dataset)
  const dirty = computed(() => active.value && Object.keys(data.value).length > 0)
  let revision = 0
  let pending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let operation = Promise.resolve()
  let disposed = false
  let submitting = false
  let writing = false
  let epoch = 0
  let restoreFailed = false

  function cancelTimer() {
    clearTimeout(timer)
    timer = undefined
  }
  function failure(error: unknown, request: number) {
    if (!disposed && revision === request && active.value) {
      storageError.value = error instanceof Error ? error.message : '草稿未保存，请保留输入后重试。'
    }
  }
  function flush(force = false): Promise<void> {
    cancelTimer()
    if (!pending || !active.value || !dataset || submitting && !force || writing) {
      return operation
    }
    writing = true
    const currentEpoch = epoch
    // 最多一笔在途写入 + 一份最新编辑态；慢磁盘时合并中间版本，不积压每次输入快照。
    operation = operation.then(async () => {
      let latestRetryAvailable = true
      try {
        while (pending && active.value && currentEpoch === epoch && (!submitting || force)) {
          const snapshot = { ...data.value }
          const currentType = type.value
          const request = revision
          pending = false
          try {
            await localOperation(() => service.save(dataset, currentType, snapshot))
            if (!disposed && request === revision) {
              storageError.value = undefined
            }
          } catch (error) {
            if (currentEpoch !== epoch || !active.value) {
              break
            }
            // 本轮失败已接管最新输入的落盘；遗留防抖不能在续写失败后再开启一轮。
            cancelTimer()
            // 新输入的防抖可能已在慢写期间触发；旧失败不能让最新快照静默搁置。
            // 每轮只额外续写最新快照一次，再失败保留提示，等待下一次正常落盘或重试。
            const retryLatest = pending && request !== revision && latestRetryAvailable
            pending = true
            failure(error, revision)
            if (!retryLatest) {
              break
            }
            latestRetryAvailable = false
          }
        }
      } finally {
        writing = false
      }
    })
    return operation
  }
  async function restore() {
    const request = ++revision
    restored.value = false
    await nextTick()
    try {
      const stored = active.value && dataset ? await localOperation(() => service.read(dataset, type.value)) : {}
      if (!disposed && request === revision && active.value) {
        data.value = stored
        restoreFailed = false
        storageError.value = undefined
      }
    } catch (error) {
      if (request === revision && active.value) {
        restoreFailed = true
      }
      failure(error, request)
    }
    if (!disposed && active.value) {
      restored.value = true
      notifyUnsavedChangesChanged()
    }
  }
  function replace(value: Record<string, string>): Promise<void> {
    if (!active.value) {
      return Promise.resolve()
    }
    const request = ++revision
    editRevision.value += 1
    try {
      data.value = sanitizeDraft(type.value, value)
      restoreFailed = false
      pending = true
      cancelTimer()
      timer = setTimeout(() => { void flush() }, DRAFT_DEBOUNCE_MS)
    } catch (error) {
      failure(error, request)
    }
    notifyUnsavedChangesChanged()
    return Promise.resolve()
  }
  async function clear() {
    ++epoch
    ++revision
    editRevision.value += 1
    cancelTimer()
    pending = false
    restoreFailed = false
    data.value = {}
    const request = revision
    const currentType = type.value
    operation = operation.then(async () => {
      if (!dataset || !active.value) {
        return
      }
      try {
        await localOperation(() => service.save(dataset, currentType, {}))
        if (request === revision) {
          storageError.value = undefined
        }
      } catch (error) {
        failure(error, request)
      }
    })
    await operation
    notifyUnsavedChangesChanged()
  }
  const stopUnsaved = registerUnsavedChanges(dirty, clear)
  const stopFlush = registerDraftFlush(async strict => {
    await flush()
    // 显式备份/恢复前不能把尚未落盘的最新输入当成已经包含；普通后台失败反馈保持原规则。
    if (strict && active.value && (pending || storageError.value)) {
      throw new LocalError('DRAFT_NOT_SAVED','最新草稿尚未保存，请先重试草稿备份。', { cause: storageError.value,retryable: true })
    }
  })
  const stopDataset = watch(() => bootstrap.datasetId, value => {
    if (value !== dataset) {
      ++revision
      pending = false
      cancelTimer()
      data.value = {}
      restored.value = false
      storageError.value = undefined
    }
  }, { flush: 'sync' })
  onDeactivated(() => { void flush() })
  onScopeDispose(() => {
    void flush()
    disposed = true
    ++revision
    cancelTimer()
    stopUnsaved()
    stopFlush()
    stopDataset()
  })
  void restore()
  return { data, dirty, restored, storageError, editRevision, restore, replace, clear,
    // 提交前排空已有写入并冻结后台 flush，防止提交清草稿后旧防抖又把它写回来。
    beginSubmit: async () => {
      submitting = true
      cancelTimer()
      await operation
      await flush(true)
    },
    endSubmit: () => {
      submitting = false
      if (pending && active.value) {
        cancelTimer()
        timer = setTimeout(() => { void flush() }, DRAFT_DEBOUNCE_MS)
      }
    },
    retryBackup: () => {
      // 读取失败时重读原草稿，不能拿空的回退表单覆盖未知版本或暂时不可读的内容。
      if (restoreFailed) {
        return restore()
      }
      pending = true
      return flush()
    } }
}
