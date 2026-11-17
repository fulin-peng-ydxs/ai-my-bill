import { watch, type Ref } from 'vue'

/** 显式选择可替换已有输入；等待恢复期间的新编辑优先，两个收支表单共享同一判据。 */
export function useTemplateDelivery(revision: () => number | undefined, editRevision: Ref<number>) {
  let baseline = editRevision.value
  watch(revision, () => { baseline = editRevision.value }, { immediate: true, flush: 'sync' })
  return () => baseline === editRevision.value
}
