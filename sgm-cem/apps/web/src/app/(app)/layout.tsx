'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { BottomNav } from '@/components/layout/BottomNav'
import { ToastContainer } from '@/components/ui/Toast'
import { ChangePassword } from '@/components/views/ChangePassword'
import { useAuthStore } from '@/store/authStore'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useSocket } from '@/hooks/useSocket'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { Bell, X as XIcon } from 'lucide-react'

// Bandeau visible pendant toute une impersonation (développeur connecté
// "en tant que" un autre utilisateur) — retour au compte DEVELOPER en un clic.
function ImpersonationBanner() {
  const { user } = useAuthStore()
  const [leaving, setLeaving] = useState(false)

  if (!user?.impersonatedBy) return null

  async function stopImpersonation() {
    setLeaving(true)
    try {
      const api = (await import('@/lib/api')).default
      await api.post('/auth/stop-impersonation')
    } catch { /* le rechargement resynchronise l'état quoi qu'il arrive */ }
    window.location.reload() // recharge tout : cookie, CSRF, /me, caches React Query
  }

  return (
    <div className="px-4 py-1.5 text-xs font-semibold text-center bg-[#0F172A] text-[#F5C400] flex items-center justify-center gap-3">
      <span>
        🛠 Mode développeur — connecté en tant que <b>{user.fullName}</b> ({user.role})
      </span>
      <button
        onClick={stopImpersonation}
        disabled={leaving}
        className="underline underline-offset-2 hover:text-white transition-colors disabled:opacity-50"
      >
        {leaving ? 'Retour…' : 'Revenir à mon compte'}
      </button>
    </div>
  )
}

// Invite d'activation des notifications push — reproposée À CHAQUE CONNEXION
// tant que l'utilisateur n'a pas cliqué « Activer » (permission 'granted').
// « Plus tard » ne masque la bannière que pour la session en cours
// (sessionStorage) : elle réapparaît à la prochaine connexion.
const PUSH_DISMISS_KEY = 'sgm-push-dismissed'

function PushPermissionBanner() {
  const { permission, enable } = usePushNotifications()
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== 'undefined' && sessionStorage.getItem(PUSH_DISMISS_KEY) === '1'
  )
  const [busy, setBusy] = useState(false)

  if (permission === 'unsupported' || permission === 'granted' || dismissed) return null

  const denied = permission === 'denied'

  async function activate() {
    setBusy(true)
    try { await enable() } finally { setBusy(false) }
  }

  function later() {
    sessionStorage.setItem(PUSH_DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="px-4 py-2 text-xs font-semibold bg-[#F5C400] text-[#0F4A0F] flex items-center justify-center gap-3 flex-wrap">
      <span className="flex items-center gap-1.5">
        <Bell size={13} />
        {denied
          ? 'Les notifications sont bloquées par votre navigateur — cliquez sur le cadenas 🔒 à côté de l\'adresse, puis autorisez les notifications.'
          : 'Activez les notifications pour être alerté des paiements, validations et litiges — même quand l\'application est fermée.'}
      </span>
      {!denied && (
        <button
          onClick={activate}
          disabled={busy}
          className="px-3 py-1 rounded-full bg-[#0F4A0F] text-[#F5C400] font-bold hover:bg-[#1A6B1A] transition-colors disabled:opacity-50"
        >
          {busy ? 'Activation…' : 'Activer les notifications'}
        </button>
      )}
      <button onClick={later} title="Plus tard (reproposé à la prochaine connexion)"
        className="text-[#0F4A0F]/60 hover:text-[#0F4A0F] transition-colors">
        <XIcon size={14} />
      </button>
    </div>
  )
}

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
        <ImpersonationBanner />
        <PushPermissionBanner />
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
  const { isAuthenticated, mustChangePassword, fetchMe, logout } = useAuthStore()
  const router = useRouter()

  // Zustand persist rehydrate le localStorage de façon asynchrone.
  // Sans ce flag, le premier rendu lit isAuthenticated=false (état initial)
  // et le useEffect suivant redirige vers '/' avant que Zustand ait le temps
  // de restaurer la session — l'utilisateur est déconnecté à chaque refresh.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  useEffect(() => {
    if (!hydrated) return  // attendre la réhydratation avant toute décision de routage

    if (!isAuthenticated) {
      router.replace('/')
      return
    }

    let cancelled = false
    fetchMe().catch(() => {
      if (!cancelled) {
        logout()
        router.replace('/')
      }
    })

    return () => {
      cancelled = true
    }
  }, [hydrated, isAuthenticated, fetchMe, logout, router])

  if (!hydrated || !isAuthenticated) return null

  // Forcer le changement de mot de passe avant d'accéder à l'app
  if (mustChangePassword) {
    return <ChangePassword />
  }

  return <AppLayoutInner>{children}</AppLayoutInner>
}
