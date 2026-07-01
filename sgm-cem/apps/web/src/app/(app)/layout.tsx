'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { BottomNav } from '@/components/layout/BottomNav'
import { ToastContainer } from '@/components/ui/Toast'
import { ChangePassword } from '@/components/views/ChangePassword'
import { useAuthStore } from '@/store/authStore'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useSocket } from '@/hooks/useSocket'

function OfflineBanner({ isOffline, queuedCount }: { isOffline: boolean; queuedCount: number }) {
  if (!isOffline && queuedCount === 0) return null
  return (
    <div className={`px-4 py-1.5 text-xs font-semibold text-center ${isOffline ? 'bg-amber-500 text-white' : 'bg-[#1A6B1A] text-white'}`}>
      {isOffline
        ? `Mode hors ligne${queuedCount > 0 ? ` — ${queuedCount} contribution(s) en attente` : ''}`
        : `${queuedCount} contribution(s) en attente de synchronisation`}
    </div>
  )
}

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const { isOffline, queuedCount } = useOfflineSync()
  useSocket()

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <OfflineBanner isOffline={isOffline} queuedCount={queuedCount} />
        <main className="flex-1 overflow-y-auto scrollbar-thin page-transition">
          {children}
        </main>
        <BottomNav />
      </div>
      <ToastContainer />
    </div>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, mustChangePassword } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated) router.replace('/')
  }, [isAuthenticated, router])

  if (!isAuthenticated) return null

  // Forcer le changement de mot de passe avant d'accéder à l'app
  if (mustChangePassword) {
    return <ChangePassword />
  }

  return <AppLayoutInner>{children}</AppLayoutInner>
}
