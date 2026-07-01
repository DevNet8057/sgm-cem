/* SGM-CEM Service Worker v1 */
const CACHE_NAME = 'sgm-cem-v1'

const PRECACHE_URLS = [
  '/',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Never intercept API calls or cross-origin
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    return
  }

  // Navigation requests: network-first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(c => c.put(request, clone))
          return res
        })
        .catch(() => caches.match(request).then(cached => cached ?? caches.match('/')))
    )
    return
  }

  // Static assets: cache-first
  if (request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          if (res.ok && res.type !== 'opaque') {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(c => c.put(request, clone))
          }
          return res
        })
      })
    )
  }
})
