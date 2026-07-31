'use client'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App, ConfigProvider } from 'antd'
import fr_FR from 'antd/locale/fr_FR'
import { MotionConfig } from 'framer-motion'
import { useState, useEffect } from 'react'
import { initCsrf } from '@/lib/api'
import { lightTheme } from '@/lib/antd-theme'
import { SplashScreen } from '@/components/ui/SplashScreen'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        retry: 1,
      },
    },
  }))

  // Initialise le jeton CSRF au chargement pour les requêtes de mutation
  useEffect(() => {
    initCsrf()
  }, [])

  return (
    // reducedMotion="user" : respecte prefers-reduced-motion de l'OS en figeant
    // les transitions APRÈS le montage (pipeline d'animation interne), sans
    // jamais changer le rendu initial SSR — évite le mismatch d'hydratation
    // que provoquerait un branchement manuel (initial={reduceMotion ? false : …}).
    <MotionConfig reducedMotion="user">
      <SplashScreen />
      <AntdRegistry layer>
        <ConfigProvider locale={fr_FR} theme={lightTheme}>
          <App>
            <QueryClientProvider client={queryClient}>
              {children}
            </QueryClientProvider>
          </App>
        </ConfigProvider>
      </AntdRegistry>
    </MotionConfig>
  )
}
