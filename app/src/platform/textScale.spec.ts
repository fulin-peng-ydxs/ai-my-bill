// @vitest-environment jsdom
import { expect,it,vi } from 'vitest'
import { installTextScale } from './textScale'
function fixture() {
  let notify:(value:{ scale:number }) => void = () => {}
  let resolve!:(value:{ scale:number }) => void
  const remove = vi.fn(async () => {})
  const platform = { addListener:vi.fn(async (_:string,callback:typeof notify) => { notify = callback; return { remove } }),
    getTextScale:vi.fn(() => new Promise<{ scale:number }>(done => { resolve = done })) }
  const root = document.createElement('html'), installed = installTextScale(platform,root)
  return { root,installed,remove,notify:(scale:number) => notify({ scale }),resolve:(scale:number) => resolve({ scale }) }
}
it('系统大字实时生效，迟到初态不覆盖新事件，无效值不改变字体',async () => {
  const f = fixture(); await Promise.resolve()
  f.notify(2); f.resolve(1); await f.installed.ready
  expect(f.root.style.webkitTextSizeAdjust).toBe('200%')
  for (const scale of [NaN,Infinity,0,9]) f.notify(scale)
  expect(f.root.style.webkitTextSizeAdjust).toBe('200%')
  f.notify(1); expect(f.root.style.webkitTextSizeAdjust).toBe('100%')
  f.notify(0.85); expect(f.root.style.webkitTextSizeAdjust).toBe('100%')
  await f.installed.stop(); expect(f.remove).toHaveBeenCalledOnce()
  f.notify(2); expect(f.root.style.webkitTextSizeAdjust).toBe('')
})
it('订阅尚未完成即销毁也释放监听，迟到回执不改变样式',async () => {
  const f = fixture(), stopped = f.installed.stop()
  await stopped
  expect(f.remove).toHaveBeenCalledOnce()
  expect(f.root.style.webkitTextSizeAdjust).toBe('')
})
