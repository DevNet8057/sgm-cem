import axios from 'axios'

// Base URL de l'API, TOUJOURS terminée par /api — export canonique : toute vue
// qui construit une URL manuellement (window.open, <a href>) DOIT passer par là.
// Ne jamais concaténer process.env.NEXT_PUBLIC_API_URL directement : selon
// l'environnement sa valeur contient ou non le suffixe /api (bug des boutons
// reçu/bordereau/rapport/GED en déploiement Docker).
export function getBaseURL() {
  // NEXT_PUBLIC_API_URL est défini AU BUILD par Next.js (ARG Docker ou
  // variable d'environnement Render). En production, il est TOUJOURS fourni
  // par le Dockerfile ARG. Le fallback hostname:3001 n'est JAMAIS atteint
  // en prod — il est réservé au dev local où API et Web tournent sur la
  // même machine (Docker Compose ou scripts/dev.mjs).
  const raw = process.env.NEXT_PUBLIC_API_URL
    ?? (typeof window !== 'undefined'
      ? `http://${window.location.hostname}:3001/api`
      : 'http://localhost:3001/api')
  return raw.endsWith('/api') ? raw : `${raw.replace(/\/$/, '')}/api`
}

const api = axios.create({
  baseURL: getBaseURL(),
  // Required so the browser sends HttpOnly auth cookies on every request
  withCredentials: true,
})

// ── CSRF token ────────────────────────────────────────────────────────────
// Fetched once on app load and kept in memory (never persisted to localStorage).
let csrfToken: string | null = null

export async function initCsrf(): Promise<void> {
  try {
    const res = await axios.get(`${getBaseURL()}/csrf-token`, { withCredentials: true })
    csrfToken = res.data.token
  } catch {
    // Non-blocking: if unreachable, requests will fail server-side with 403
  }
}

// Include CSRF token on state-changing requests
api.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toLowerCase()
  if (['post', 'put', 'patch', 'delete'].includes(method) && csrfToken) {
    config.headers['x-csrf-token'] = csrfToken
  }
  return config
})

// ── Token refresh ─────────────────────────────────────────────────────────
let isRefreshing = false
let refreshQueue: Array<() => void> = []

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Auto-guérison CSRF : si le jeton en mémoire ne correspond plus au cookie
    // de session (refresh dans un autre onglet, impersonation, dérive quelconque),
    // resynchroniser puis rejouer UNE fois. Le request interceptor réinjectera
    // le jeton frais.
    if (
      error.response?.status === 403 &&
      error.response?.data?.error?.code === 'CSRF_INVALID' &&
      !originalRequest._csrfRetry &&
      typeof window !== 'undefined'
    ) {
      originalRequest._csrfRetry = true
      await initCsrf()
      return api.request(originalRequest)
    }

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      typeof window !== 'undefined'
    ) {
      if (isRefreshing) {
        return new Promise<void>((resolve) => {
          refreshQueue.push(resolve)
        }).then(() => api.request(originalRequest))
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        // Always fetch a fresh CSRF token BEFORE the refresh POST.
        // On full page reload, csrfToken is null until Providers's initCsrf() resolves,
        // but AppLayout's useEffect (child) fires before Providers's (parent), so fetchMe()
        // can trigger this interceptor while csrfToken is still null — causing a 403 CSRF.
        await initCsrf()

        // Refresh token is in an HttpOnly cookie — just POST, no body needed.
        // Use axios directly but include the freshly-fetched CSRF token manually,
        // since this raw axios call bypasses the api request interceptor.
        await axios.post(`${getBaseURL()}/auth/refresh`, {}, {
          withCredentials: true,
          headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
        })

        // CRITIQUE : le refresh vient de poser un NOUVEAU cookie access_token,
        // or le jeton CSRF est lié à ce cookie (double-submit). Sans cette
        // resynchronisation, TOUTES les requêtes mutantes suivantes échouent
        // en 403 « Jeton CSRF invalide » jusqu'au rechargement de la page.
        await initCsrf()

        refreshQueue.forEach((resolve) => resolve())
        refreshQueue = []

        return api.request(originalRequest)
      } catch {
        // Clear persisted auth state so the user is sent to the login page cleanly
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('sgm-cem-auth')
        }
        refreshQueue = []
        window.location.href = '/'
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)

export default api
