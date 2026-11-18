import { getCurrentInstance, onDeactivated, onScopeDispose } from 'vue'

export interface DebouncedQuery<T> {
  schedule: (value: T) => void
  submit: (value: T) => void
  cancel: () => void
  /** 仅表示计时器尚未触发，不包含已经提交、仍在执行中的查询。 */
  isPending: () => boolean
}

/** 统一短防抖；Enter、清空等显式动作使用 submit 立即执行，缓存页停用或作用域销毁时自动取消。 */
export function useDebouncedQuery<T>(callback: (value: T) => void, delay = 300): DebouncedQuery<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancel(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function submit(value: T): void {
    cancel()
    callback(value)
  }

  function schedule(value: T): void {
    cancel()
    timer = setTimeout(() => {
      timer = undefined
      callback(value)
    }, delay)
  }

  if (getCurrentInstance()) onDeactivated(cancel)
  onScopeDispose(cancel)
  return { schedule, submit, cancel, isPending: () => timer !== undefined }
}
