import type { PluginListenerHandle } from '@capacitor/core'
import { nativeAppearance,type NativeAppearance } from './appearance'
type TextScale = Pick<NativeAppearance,'getTextScale' | 'addListener'>

/** 共享入口只调整 WebKit 文本缩放；布局、页面样式和原默认字号不变。 */
export function installTextScale(platform:TextScale = nativeAppearance, root:HTMLElement = document.documentElement) {
  let stopped = false, revision = 0, listener:PluginListenerHandle | undefined
  let stopping:Promise<void> | undefined
  const previous = root.style.webkitTextSizeAdjust
  const apply = ({ scale }:{ scale:number }) => {
    if (stopped || !Number.isFinite(scale) || scale < 0.8 || scale > 3.2) return
    // 保留原始输入字号下限，避免小字偏好把 16px 数值输入缩小并触发 iOS 自动放大。
    const value = `${Math.max(1,scale) * 100}%`
    if (root.style.webkitTextSizeAdjust !== value) root.style.webkitTextSizeAdjust = value
  }
  const ready = (async () => {
    listener = await platform.addListener('textScale',value => { revision++; apply(value) })
    if (stopped) { await listener.remove(); listener = undefined; return }
    const readRevision = revision
    try {
      const value = await platform.getTextScale()
      if (revision === readRevision) apply(value)
    } catch { /* 读取失败保留最近系统通知，不阻断本地账本。 */ }
  })().catch(() => {})
  return { ready,stop:() => stopping ??= (async () => { stopped = true; revision++; root.style.webkitTextSizeAdjust = previous
    await ready; await listener?.remove(); listener = undefined })() }
}
