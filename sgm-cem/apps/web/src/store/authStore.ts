import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'
import api, { initCsrf } from '@/lib/api'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  mustChangePassword: boolean
  login: (email: string, password: string) => Promise<void>
  loginWithGoogle: (idToken: string) => Promise<void>
  loginWithPhone: (phone: string, code: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: User | null) => void
  setMustChangePassword: (value: boolean) => void
  fetchMe: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      mustChangePassword: false,

      login: async (email, password) => {
        // Tokens are set as HttpOnly cookies by the server — never touch localStorage
        const res = await api.post('/auth/login', { email, password })
        const { user } = res.data.data
        // Le token CSRF est lié au cookie access_token : après login il faut le
        // resynchroniser, sinon la 1re requête mutante échoue en "CSRF invalide".
        await initCsrf()
        set({ user, isAuthenticated: true, mustChangePassword: !!user.mustChangePassword })
      },

      loginWithGoogle: async (idToken) => {
        const res = await api.post('/auth/google', { idToken })
        const { user } = res.data.data
        await initCsrf()
        set({ user, isAuthenticated: true, mustChangePassword: !!user.mustChangePassword })
      },

      loginWithPhone: async (phone, code) => {
        const res = await api.post('/auth/otp/verify', { phone, code })
        const { user } = res.data.data
        await initCsrf()
        set({ user, isAuthenticated: true, mustChangePassword: !!user.mustChangePassword })
      },

      logout: async () => {
        try {
          await api.post('/auth/logout')
        } catch {}
        // Resynchronise le token CSRF sur la session déconnectée (access_token vide)
        // pour que le prochain login parte avec un token valide.
        await initCsrf()
        set({ user: null, isAuthenticated: false, mustChangePassword: false })
      },

      setUser: (user) => set({ user, isAuthenticated: !!user, mustChangePassword: !!user?.mustChangePassword }),

      setMustChangePassword: (value) => set({ mustChangePassword: value }),

      fetchMe: async () => {
        const res = await api.get('/auth/me')
        const user = res.data.data
        set({ user, isAuthenticated: true, mustChangePassword: !!user.mustChangePassword })
      },
    }),
    {
      name: 'sgm-cem-auth',
      // Only persist non-sensitive user metadata — never tokens
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        mustChangePassword: state.mustChangePassword,
      }),
    }
  )
)
