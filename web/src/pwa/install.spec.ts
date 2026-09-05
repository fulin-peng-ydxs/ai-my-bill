import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { detectInstallPlatform, usePwaInstallStore } from './install'

beforeEach(() => setActivePinia(createPinia()))

describe('PWA install state', () => {
  it('provides platform-specific manual guidance', () => {
    expect(detectInstallPlatform('Mozilla/5.0 (iPhone)')).toBe('ios')
    expect(detectInstallPlatform('Mozilla/5.0 (Linux; Android 15)')).toBe('android')
    expect(detectInstallPlatform('Mozilla/5.0 (Macintosh)')).toBe('desktop')
  })

  it('shows a real action only after receiving a browser install prompt', async () => {
    const store = usePwaInstallStore()
    const prompt = vi.fn().mockResolvedValue(undefined)
    const event = {
      preventDefault: vi.fn(),
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' }),
    } as unknown as BeforeInstallPromptEvent

    store.capturePrompt(event)
    expect(store.status).toBe('available')
    await store.install()

    expect(prompt).toHaveBeenCalledOnce()
    expect(store.status).toBe('declined')
  })

  it('does not overwrite an appinstalled event that wins the install race', async () => {
    const store = usePwaInstallStore()
    let acceptInstall: (choice: { outcome: 'accepted', platform: string }) => void = () => undefined
    const event = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: new Promise<{ outcome: 'accepted', platform: string }>((resolve) => {
        acceptInstall = resolve
      }),
    } as unknown as BeforeInstallPromptEvent

    store.capturePrompt(event)
    const installing = store.install()
    await Promise.resolve()
    store.markInstalled()
    acceptInstall({ outcome: 'accepted', platform: 'web' })
    await installing

    expect(store.status).toBe('installed')
  })
})
