/* SGM-CEM Service Worker v4
 * - Pages : réseau d'abord, copie de secours pour l'ouverture hors ligne
 *   (réponses 200 uniquement, jamais une page d'erreur).
 * - /_next/static (fichiers versionnés, immuables) et icônes : cache d'abord.
 * - API et autres origines : jamais interceptées (pas de donnée périmée).
 * Changer CACHE_NAME purge l'ancien cache à l'activation. */
const CACHE_NAME = 'sgm-cem-v4'
const PRECACHE_URLS = ['/', '/manifest.json', '/icon-192.png']
const MAX_PAGES = 30

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

async function trimPages(cache) {
  const keys = (await cache.keys()).filter(r => !new URL(r.url).pathname.startsWith('/_next/'))
  for (const r of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(r)
}

function isImmutableAsset(url) {
  return url.pathname.startsWith('/_next/static/') || /^\/(icon-|apple-touch-icon|favicon)/.test(url.pathname)
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok && res.type === 'basic') {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(c => c.put(request, clone).then(() => trimPages(c)))
          }
          return res
        })
        .catch(() => caches.match(request).then(cached => cached ?? caches.match('/')))
    )
    return
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(cached => cached ?? fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(c => c.put(request, clone))
        }
        return res
      }))
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

/* Clic sur la notification : ouvrir l'écran concerné (une URL par écran) */
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const wanted = event.notification.data && event.notification.data.url
  // Uniquement un chemin interne de l'application, jamais une URL externe
  const target = typeof wanted === 'string' && /^\/dashboard(\/[a-z-]+)?$/.test(wanted) ? wanted : '/dashboard'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.startsWith(self.location.origin))
      if (existing) return existing.navigate(target).then(c => (c || existing).focus())
      return clients.openWindow(target)
    })
  )
})
