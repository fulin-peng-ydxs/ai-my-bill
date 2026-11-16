import { computed, nextTick, onScopeDispose, ref, type Ref } from 'vue'
import type { EntryType } from '../domain/preferences'
import { registerUnsavedChanges, notifyUnsavedChangesChanged } from './unsavedChanges'

/** T4 仅保留缓存页内输入；T7 接统一 SQLite 草稿，当前不伪装持久化成功。 */
export function useLedgerDraft(type: Ref<EntryType>, enabled?: Ref<boolean>) {
  const data = ref<Record<string, string>>({})
  const restored = ref(false)
  const storageError = ref<string>()
  const dirty = computed(() => (enabled?.value ?? true) && Object.keys(data.value).length > 0)
  const clear = async () => {
    data.value = {}
    notifyUnsavedChangesChanged()
  }
  const stop = registerUnsavedChanges(dirty, clear)
  onScopeDispose(stop)
  const replace = async (value: Record<string, string>) => {
    if (enabled?.value ?? true) {
      data.value = { ...value }
    }
    notifyUnsavedChangesChanged()
  }
  const restore = async () => {
    restored.value = true
  }
  // 与原表单的恢复观察器保持时序；不在调用方注册观察器前发布完成信号。
  void nextTick(restore)
  return {
    data,
    restored,
    storageError,
    dirty,
    replace,
    clear,
    restore,
    retryBackup: async () => {},
  }
}
