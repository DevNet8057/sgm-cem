/* SGM-CEM Service Worker v2 */
const CACHE_NAME = 'sgm-cem-v3'

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

/* ── WEB PUSH — notifications dans la barre système ─────────────────── */
self.addEventListener('push', event => {
  let payload = { title: 'SGM-CEM', body: 'Nouvelle notification' }
  try { payload = { ...payload, ...event.data.json() } } catch { /* payload texte ou vide */ }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: payload.data ?? {},
      // regrouper les notifications de même type plutôt que d'empiler
      tag: (payload.data && payload.data.tag) || 'sgm-cem',
      renotify: true,
    })
  )
})

/* Clic sur la notification : focaliser l'app (ou l'ouvrir) sur le dashboard */
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin))
      if (existing) return existing.focus()
      return clients.openWindow('/dashboard')
    })
  )
})
