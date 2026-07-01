import axios from 'axios'

function getBaseURL() {
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:3001/api`
  }
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api'
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
        // Refresh token is in an HttpOnly cookie — just POST, no body needed
        await axios.post(`${getBaseURL()}/auth/refresh`, {}, { withCredentials: true })

        // Renew CSRF token after refresh so it stays valid
        await initCsrf()

        refreshQueue.forEach((resolve) => resolve())
        refreshQueue = []

        return api.request(originalRequest)
      } catch {
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
