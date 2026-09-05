/// <reference types="vite/client" />

interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

interface Navigator {
  readonly standalone?: boolean
}
