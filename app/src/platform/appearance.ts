import { registerPlugin,type PluginListenerHandle } from '@capacitor/core'
import type { ResolvedTheme } from '../theme/theme'
export interface NativeAppearance {
  getTextScale():Promise<{ scale:number }>
  addListener(event:'textScale',callback:(value:{ scale:number }) => void):Promise<PluginListenerHandle>
  setTheme(options:{ theme:ResolvedTheme }):Promise<void>
}
export const nativeAppearance = registerPlugin<NativeAppearance>('LedgerAppearance')
export async function setNativeTheme(theme:ResolvedTheme,bridge:Pick<NativeAppearance,'setTheme'> = nativeAppearance) {
  try { await bridge.setTheme({ theme }) }
  catch { /* 原生外观不可用不撤销已保存偏好，也不阻断账本打开。 */ }
}
