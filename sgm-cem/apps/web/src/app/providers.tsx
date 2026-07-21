'use client'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App, ConfigProvider } from 'antd'
import fr_FR from 'antd/locale/fr_FR'
import { useState, useEffect } from 'react'
import { initCsrf } from '@/lib/api'
import { lightTheme } from '@/lib/antd-theme'

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
    <AntdRegistry layer>
      <ConfigProvider locale={fr_FR} theme={lightTheme}>
        <App>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </App>
      </ConfigProvider>
    </AntdRegistry>
  )
}
