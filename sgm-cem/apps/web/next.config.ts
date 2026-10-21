import path from 'node:path'
import type { NextConfig } from 'next'

// Sur Render, le navigateur ne parle qu'au web : /api, /socket.io et /uploads
// sont proxifiés vers le service api interne (cookies first-party — deux
// sous-domaines onrender.com seraient « cross-site » et sameSite: lax bloquerait
// l'authentification). Inactif en dev local et en Docker Compose (variables absentes).
// Voir DEPLOIEMENT_RENDER.md.
// Netlify cible l'API Render externe en HTTPS. Les variables HOST/PORT gardent
// la compatibilité avec l'ancien proxy interne Render.
const apiProxyTarget = process.env.API_PROXY_URL
  ?? (process.env.API_PROXY_HOST
    ? `http://${process.env.API_PROXY_HOST}:${process.env.API_PROXY_PORT ?? '10000'}`
    : null)

const nextConfig: NextConfig = {
  // Serveur autonome (.next/standalone) : l'image Docker n'embarque que le strict
  // nécessaire à l'exécution (≈ 10 fois plus légère). Racine = monorepo pnpm.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@sgm-cem/shared'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  images: {
    remotePatterns: [{ protocol: 'http', hostname: 'localhost' }],
  },
  async rewrites() {
    if (!apiProxyTarget) return []
    return [
      { source: '/api/:path*', destination: `${apiProxyTarget}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${apiProxyTarget}/socket.io/:path*` },
      { source: '/uploads/:path*', destination: `${apiProxyTarget}/uploads/:path*` },
    ]
  },
}

export default nextConfig
