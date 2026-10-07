import { onScopeDispose, watch } from 'vue'

let active: (() => void) | undefined

/** 一次只编辑一个候选字段；交接先关闭旧列表，关闭时不抢回新字段焦点。 */
export function useActiveCombobox(isOpen: () => boolean, close: () => void) {
  watch(isOpen, (open) => {
    if (open) {
      if (active !== close) active?.()
      active = close
    } else if (active === close) active = undefined
  }, { flush: 'sync' })
  onScopeDispose(() => { if (active === close) active = undefined })
}
