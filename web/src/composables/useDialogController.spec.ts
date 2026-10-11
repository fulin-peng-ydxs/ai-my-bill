/* eslint-disable vue/one-component-per-file -- 生命周期宿主测试需要同时挂载父层、子层及 KeepAlive 容器。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, h, KeepAlive, markRaw, nextTick, ref } from 'vue'
import { dialogMessageTarget, useDialogController } from './useDialogController'

class FocusTarget {
  isConnected = true
  focus = vi.fn()
}
class NativeDialog extends FocusTarget {
  open = false
  showModal(): void { this.open = true }
  close(): void { this.open = false }
  contains(target: unknown): boolean { return target === this }
  getBoundingClientRect() { return { left: 100, right: 300, top: 100, bottom: 300 } }
}
// 无浏览器的宿主只负责 Vue 生命周期，原生 top layer/触摸另由实际页面验证。
interface HostNode { children: HostNode[]; parent?: HostNode }
const renderer = createRenderer<HostNode, HostNode>({
  createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }),
  insert: (node, parent) => { node.parent = parent; parent.children.push(node) }, remove: () => {},
  setText: () => {}, setElementText: () => {}, patchProp: () => {}, parentNode: node => node.parent ?? null, nextSibling: () => null,
})
const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.stubGlobal('HTMLElement', FocusTarget)
  vi.stubGlobal('document', { activeElement: new FocusTarget() })
})
afterEach(() => { cleanups.splice(0).reverse().forEach(stop => stop()); vi.unstubAllGlobals() })

async function settle(): Promise<void> { await nextTick(); await nextTick() }

async function mountDialog(busy = ref(false)) {
  const open = ref(true)
  const element = markRaw(new NativeDialog())
  let controller!: ReturnType<typeof useDialogController>
  const app = renderer.createApp(defineComponent({ setup() {
    controller = useDialogController(open, value => { if (!busy.value) open.value = value })
    controller.dialog.value = element as unknown as HTMLDialogElement
    return () => h('div')
  } }))
  app.mount({ children: [] })
  cleanups.push(() => app.unmount())
  await settle()
  return { open, element, controller }
}
function pointer(element: NativeDialog, x = 20, y = 20): PointerEvent {
  return { target: element, pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y,
    preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as PointerEvent
}
function tap(layer: Awaited<ReturnType<typeof mountDialog>>, start = pointer(layer.element), end = start): void {
  layer.controller.handlePointerDown(start)
  layer.controller.handlePointerUp(end)
  layer.controller.handleBackdropClick(end)
}

describe('shared dialog dismissal', () => {
  it('closes only the top layer and returns focus to its parent', async () => {
    const parent = await mountDialog()
    vi.stubGlobal('document', { activeElement: parent.element })
    const child = await mountDialog()
    expect(dialogMessageTarget.value).toBe(child.element)
    tap(parent)
    expect(parent.open.value).toBe(true)
    tap(child)
    await settle()
    child.controller.handleClose()
    expect(child.element.open).toBe(false)
    expect(parent.element.open).toBe(true)
    expect(dialogMessageTarget.value).toBe(parent.element)
    expect(parent.element.focus).toHaveBeenCalledOnce()
  })
  it('ignores a drag from content, a moving backdrop gesture and pointer cancellation', async () => {
    const layer = await mountDialog()
    tap(layer, pointer(layer.element, 200, 200), pointer(layer.element))
    tap(layer, pointer(layer.element), pointer(layer.element, 20, 60))
    layer.controller.handlePointerDown(pointer(layer.element))
    layer.controller.handlePointerCancel()
    layer.controller.handlePointerUp(pointer(layer.element))
    layer.controller.handleBackdropClick(pointer(layer.element))
    expect(layer.open.value).toBe(true)
    tap(layer)
    await settle()
    expect(layer.element.open).toBe(false)
  })
  it('keeps busy layers open for backdrop and Esc, then allows another close attempt', async () => {
    const busy = ref(true)
    const layer = await mountDialog(busy)
    tap(layer)
    layer.controller.handleCancel(pointer(layer.element))
    expect(layer.open.value).toBe(true)
    busy.value = false
    tap(layer)
    await settle()
    expect(layer.element.open).toBe(false)
  })
  it('ignores an old close event after immediate reopening', async () => {
    const layer = await mountDialog()
    tap(layer)
    await settle()
    layer.open.value = true
    await settle()
    layer.controller.handleClose()
    expect(layer.open.value).toBe(true)
    expect(layer.element.open).toBe(true)
    const trigger = document.activeElement as unknown as FocusTarget
    expect(trigger.focus).not.toHaveBeenCalled()
    layer.open.value = false
    await settle()
    layer.controller.handleClose()
    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
  it('restores cached parent/child order even when the child precedes its parent in the template', async () => {
    const active = ref(true)
    const parentOpen = ref(false), childOpen = ref(false)
    const parent = markRaw(new NativeDialog()), child = markRaw(new NativeDialog())
    let parentController!: ReturnType<typeof useDialogController>
    let childController!: ReturnType<typeof useDialogController>
    const layers = defineComponent({ setup() {
      childController = useDialogController(childOpen, value => { childOpen.value = value })
      parentController = useDialogController(parentOpen, value => { parentOpen.value = value })
      childController.dialog.value = child as unknown as HTMLDialogElement
      parentController.dialog.value = parent as unknown as HTMLDialogElement
      return () => h('div')
    } })
    const app = renderer.createApp({ setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(layers) : null }) })
    app.mount({ children: [] })
    cleanups.push(() => app.unmount())
    parentOpen.value = true
    await settle()
    childOpen.value = true
    await settle()
    active.value = false
    await settle()
    expect([parent.open, child.open]).toEqual([false, false])
    parentController.handleClose(); childController.handleClose()
    active.value = true
    await settle()
    childController.handlePointerDown(pointer(child))
    childController.handlePointerUp(pointer(child))
    childController.handleBackdropClick(pointer(child))
    await settle()
    expect([parent.open, child.open]).toEqual([true, false])
  })
})
