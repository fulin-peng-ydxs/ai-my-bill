import { readonly, ref, watch, type Ref } from 'vue'

interface UnsavedSource {
  dirty: () => boolean
  discard: (reason: UnsavedChangeReason) => void | Promise<void>
}

export type UnsavedChangeReason = 'navigation' | 'logout' | 'account-change'

const sources = new Map<symbol, UnsavedSource>()
const hasUnsavedChanges = ref(false)
const dialogOpen = ref(false)
const discarding = ref(false)
let pendingResolution: ((confirmed: boolean) => void) | undefined
const pendingReason = ref<UnsavedChangeReason>('navigation')
let installed = false

function refresh(): void {
  hasUnsavedChanges.value = [...sources.values()].some((source) => source.dirty())
}

function register(source: UnsavedSource, dirty: Ref<boolean>): () => void {
  const id = Symbol('unsaved-source')
  sources.set(id, source)
  const stop = watch(dirty, refresh)
  refresh()
  return () => {
    stop()
    sources.delete(id)
    refresh()
  }
}

export function registerUnsavedChanges(
  dirty: Ref<boolean>,
  discard: (reason: UnsavedChangeReason) => void | Promise<void>,
): () => void {
  return register({ dirty: () => dirty.value, discard }, dirty)
}

export function notifyUnsavedChangesChanged(): void {
  refresh()
}

export function requestDiscardChanges(reason: UnsavedChangeReason = 'navigation'): Promise<boolean> {
  if (!hasUnsavedChanges.value) return Promise.resolve(true)
  if (pendingResolution) return Promise.resolve(false)
  pendingReason.value = reason
  dialogOpen.value = true
  return new Promise((resolve) => {
    pendingResolution = resolve
  })
}

export function hasUnsavedChangesNow(): boolean {
  return hasUnsavedChanges.value
}

export function cancelDiscardChanges(): void {
  dialogOpen.value = false
  pendingResolution?.(false)
  pendingResolution = undefined
}

export async function confirmDiscardChanges(): Promise<void> {
  if (!pendingResolution || discarding.value) return
  discarding.value = true
  const resolve = pendingResolution
  try {
    const dirtySources = [...sources.values()].filter((source) => source.dirty())
    await Promise.all(dirtySources.map((source) => source.discard(pendingReason.value)))
    dialogOpen.value = false
    pendingResolution = undefined
    refresh()
    resolve(true)
  } catch {
    resolve(false)
    pendingResolution = undefined
    dialogOpen.value = false
  } finally {
    discarding.value = false
  }
}

export function installBeforeUnloadGuard(): void {
  if (installed || typeof window === 'undefined') return
  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedChanges.value) return
    event.preventDefault()
    event.returnValue = ''
  })
  installed = true
}

export function useUnsavedChangesState() {
  return {
    open: readonly(dialogOpen),
    discarding: readonly(discarding),
    hasUnsavedChanges: readonly(hasUnsavedChanges),
    reason: readonly(pendingReason),
  }
}
