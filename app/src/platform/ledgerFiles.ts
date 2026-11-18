import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/** 文件能力只接受数据库标识，不接受来自页面/备份的任意沙盒路径。 */
export interface LedgerFiles {
  protect(options: { name: string }): Promise<{ excluded: boolean; protected: boolean; simulator: boolean }>
  snapshot(options: { name: string }): Promise<{ id: string; bytes: number; sha256: string; excluded: boolean; protected: boolean; simulator: boolean }>
}
interface DraftLifecycle {
  addListener(event: 'background' | 'foreground', callback: () => void): Promise<PluginListenerHandle>
  /** 注册监听后读取冷启动初态，不由 DOM 可见性推断原生活跃状态。 */
  getLifecycleState(): Promise<{ active: boolean }>
  finishBackground(): Promise<void>
}
export const ledgerFiles = registerPlugin<LedgerFiles & DraftLifecycle>('LedgerFiles')
