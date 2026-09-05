const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:css|js|woff2?|png|svg|webp)$/

export function isApiOrDownloadPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname.startsWith('/downloads/')
}

export function isCacheableStaticAsset(url: URL, origin: string): boolean {
  return url.origin === origin && HASHED_ASSET.test(url.pathname)
}
