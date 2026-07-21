import '@ant-design/v5-patch-for-react-19'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'SGM-CEM — Système de Gestion du Ministère',
  description: "Culte d'Enfants de Melen · EEC Yaoundé",
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'SGM-CEM' },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#0F4A0F',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/*
          Pour que Google OAuth fonctionne, l'origine http://localhost:3000 doit être ajoutée
          manuellement dans Google Cloud Console → APIs & Services → Credentials → OAuth 2.0
          Client ID → Origines JavaScript autorisées. En production, remplacer par l'URL de prod.
          Ne pas ajouter crossOrigin="anonymous" ici — Google GSI ne supporte pas le CORS et
          le navigateur bloque le script si l'attribut est présent.
        */}
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="lazyOnload"
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
