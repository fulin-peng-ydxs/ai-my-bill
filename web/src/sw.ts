import { isApiOrDownloadPath, isCacheableStaticAsset } from './pwa/cachePolicy'

declare const self: ServiceWorkerGlobalScope
declare const __MY_BILL_CACHE_NAME__: string

const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(__MY_BILL_CACHE_NAME__).then((cache) => cache.add(OFFLINE_URL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(async (keys) => {
    await Promise.all(keys
      .filter((key) => key.startsWith('my-bill-static-') && key !== __MY_BILL_CACHE_NAME__)
      .map((key) => caches.delete(key)))
    await self.clients.claim()
  }))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || isApiOrDownloadPath(url.pathname)) {
    event.respondWith(fetch(request))
    return
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const offline = await caches.match(OFFLINE_URL)
      return offline ?? Response.error()
    }))
    return
  }
  if (!isCacheableStaticAsset(url, self.location.origin)) {
    event.respondWith(fetch(request))
    return
  }
  event.respondWith(caches.match(request).then(async (cached) => {
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(__MY_BILL_CACHE_NAME__)
      await cache.put(request, response.clone())
    }
    return response
  }))
})

export {}
