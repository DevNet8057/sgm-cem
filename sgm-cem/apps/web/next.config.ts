import type { NextConfig } from 'next'

// Sur Render, le navigateur ne parle qu'au web : /api, /socket.io et /uploads
// sont proxifiés vers le service api interne (cookies first-party — deux
// sous-domaines onrender.com seraient « cross-site » et sameSite: lax bloquerait
// l'authentification). Inactif en dev local et en Docker Compose (variables absentes).
// Voir DEPLOIEMENT_RENDER.md.
const apiProxyTarget = process.env.API_PROXY_HOST
  ? `http://${process.env.API_PROXY_HOST}:${process.env.API_PROXY_PORT ?? '10000'}`
  : null

const nextConfig: NextConfig = {
  transpilePackages: ['@sgm-cem/shared'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', '@radix-ui/react-dialog'],
  },
  images: {
    domains: ['localhost'],
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
