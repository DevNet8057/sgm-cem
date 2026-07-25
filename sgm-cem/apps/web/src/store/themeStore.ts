import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppTheme = 'dark' | 'light'

interface ThemeState {
  theme: AppTheme
  toggleTheme: () => void
  setTheme: (theme: AppTheme) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      toggleTheme: () => set(state => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'sgm-cem-theme' }
  )
)
