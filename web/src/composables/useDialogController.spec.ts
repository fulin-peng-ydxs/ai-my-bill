import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

const { hooks } = vi.hoisted(() => ({ hooks: { mounted: [] as Array<() => void>, suspend: [] as Array<() => void>, activate: [] as Array<() => void> } }))
vi.mock('vue', async (original) => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => hooks.mounted.push(callback),
  onBeforeUnmount: (callback: () => void) => hooks.suspend.push(callback),
  onDeactivated: (callback: () => void) => hooks.suspend.push(callback),
  onActivated: (callback: () => void) => hooks.activate.push(callback),
}))
import { useDialogController } from './useDialogController'

afterEach(() => {
  Object.values(hooks).forEach(list => list.splice(0))
  vi.unstubAllGlobals()
})

describe('native dialog lifecycle', () => {
  it('ignores a queued close after reopening and restores focus only after final close', async () => {
    class FocusTarget { isConnected = true; focus = vi.fn() }
    const trigger = new FocusTarget()
    vi.stubGlobal('HTMLElement', FocusTarget)
    vi.stubGlobal('document', { activeElement: trigger, querySelector: () => null })
    const open = ref(true)
    const setOpen = vi.fn((value: boolean) => { open.value = value })
    const scope = effectScope()
    const controller = scope.run(() => useDialogController(open, setOpen))!
    const native = { open: false, showModal() { this.open = true }, close() { this.open = false } }
    controller.dialog.value = native as HTMLDialogElement
    hooks.mounted.forEach(callback => callback())
    await nextTick()
    open.value = false
    await nextTick(); await nextTick()
    open.value = true
    await nextTick(); await nextTick()
    controller.handleClose()
    expect(native.open).toBe(true)
    expect(setOpen).not.toHaveBeenCalled()
    expect(trigger.focus).not.toHaveBeenCalled()
    open.value = false
    await nextTick(); await nextTick()
    controller.handleClose()
    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true })
    scope.stop()
  })
})
