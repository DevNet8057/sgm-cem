import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@sgm-cem/shared'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', '@radix-ui/react-dialog'],
  },
  images: {
    domains: ['localhost'],
  },
}

export default nextConfig
