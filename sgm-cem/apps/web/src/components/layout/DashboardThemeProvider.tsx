'use client'

import { useEffect } from 'react'
import { App, ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { dashboardTheme, dashboardThemeLight } from '@/lib/antd-theme'
import { useThemeStore } from '@/store/themeStore'

/**
 * Applique le thème AntD "fintech premium" (dashboardTheme sombre par défaut,
 * dashboardThemeLight si l'utilisateur bascule) et les tokens CSS associés à
 * tout l'espace authentifié. Ce provider canonique est monté une seule fois
 * dans src/app/(app)/layout.tsx.
 *
 * Le ConfigProvider racine (src/app/providers.tsx) reste sur lightTheme pour
 * le login et les pages publiques. Ce wrapper imbriqué surcharge localement les
 * tokens AntD sans toucher au thème global.
 *
 * `display: contents` (classe Tailwind `contents`) rend ce wrapper transparent
 * au layout : les enfants directs (ex. Layout.Sider + Drawer dans Sidebar,
 * ou header/nav) conservent leur position dans un parent flex sans qu'une
 * div supplémentaire ne casse la structure.
 */
export function DashboardThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeStore(state => state.theme)

  useEffect(() => {
    document.body.dataset.theme = theme
    return () => { delete document.body.dataset.theme }
  }, [theme])

  return (
    <ConfigProvider theme={theme === 'light' ? dashboardThemeLight : dashboardTheme}>
      <App className="dash-scope contents" data-theme={theme}>{children}</App>
    </ConfigProvider>
  )
}
