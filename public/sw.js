const CACHE_PREFIX = 'kelilingku-shell-'
const CACHE_NAME = `${CACHE_PREFIX}v2`
const OFFLINE_URL = '/offline.html'
const MAX_ASSETS = 64
const APP_SHELL = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/kelilingku-icon.svg',
  '/icons/kelilingku-icon-192.svg',
  '/icons/kelilingku-icon-512.svg',
  '/icons/kelilingku-icon-192.png',
  '/icons/kelilingku-icon-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || request.headers.has('Authorization') || request.cache === 'no-store') return

  const requestUrl = new URL(request.url)
  if (requestUrl.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(offlineResponse))
    return
  }

  const bundledAsset = /^\/assets\/[^/]+\.(js|css|png|svg|jpe?g|webp|woff2?)$/.test(requestUrl.pathname)
  if (requestUrl.search || (!bundledAsset && !APP_SHELL.includes(requestUrl.pathname))) return
  const response = staticResponse(request, requestUrl.pathname, bundledAsset)
  event.respondWith(response)
  event.waitUntil(response.then(() => undefined).catch(() => undefined))
})

async function offlineResponse() {
  let html
  try {
    const cache = await caches.open(CACHE_NAME)
    html = await (await cache.match(OFFLINE_URL))?.text()
  } catch { /* Storage may be evicted or unavailable. */ }
  return new Response(html || '<!doctype html><html lang="id"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kelilingku offline</title><h1>Koneksi terputus</h1><p>Hubungkan internet, lalu coba lagi.</p><a href="">Coba lagi</a></html>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '5' },
  })
}

function isCacheable(response, pathname) {
  if (response.status !== 200 || /\bno-store\b/i.test(response.headers.get('Cache-Control') || '')) return false
  const type = response.headers.get('Content-Type') || ''
  if (pathname.endsWith('.js')) return /(?:javascript|ecmascript)/i.test(type)
  if (pathname.endsWith('.css')) return /text\/css/i.test(type)
  if (pathname === OFFLINE_URL) return /text\/html/i.test(type)
  if (pathname.endsWith('.webmanifest')) return /json/i.test(type)
  if (/\.woff2?$/.test(pathname)) return /font\/|application\/(?:font|octet-stream)/i.test(type)
  return /^image\//i.test(type)
}

async function staticResponse(request, pathname, bundledAsset) {
  let cache
  let cached
  try {
    cache = await caches.open(CACHE_NAME)
    cached = await cache.match(request)
  } catch { /* A cache failure must not hide a successful network response. */ }
  if (bundledAsset && cached) return cached
  try {
    const response = await fetch(request)
    if (cache && isCacheable(response, pathname)) {
      try {
        await cache.put(request, response.clone())
        const assets = (await cache.keys()).filter(entry => new URL(entry.url).pathname.startsWith('/assets/'))
        for (const stale of assets.slice(0, Math.max(0, assets.length - MAX_ASSETS))) await cache.delete(stale)
      } catch { /* Quota failures do not make online assets unavailable. */ }
    }
    return response
  } catch {
    return cached || Response.error()
  }
}
