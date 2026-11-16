import { onActivated } from 'vue'

/** 保留页面交互状态，首次加载仍由调用方负责；返回缓存页时刷新可变数据。 */
export function useRefreshOnReturn(refresh: () => void | Promise<void>): void {
  let first = true
  onActivated(() => {
    if (first) { first = false; return }
    void refresh()
  })
}
