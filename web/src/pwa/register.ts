/** 生产构建才注册 Service Worker，避免开发缓存掩盖源码和接口变化。 */
export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'module' })
  } catch (error) {
    console.warn('Service Worker 注册失败，应用继续以网页模式运行。', error)
  }
}
