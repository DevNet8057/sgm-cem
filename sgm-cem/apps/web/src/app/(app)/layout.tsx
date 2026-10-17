'use client'
import { useEffect, useLayoutEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAppStore } from '@/store/appStore'
import { viewFromPath } from '@/lib/view-routing'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { BottomNav } from '@/components/layout/BottomNav'
import { ToastContainer } from '@/components/ui/Toast'
import { ChangePassword } from '@/components/views/ChangePassword'
import { useAuthStore } from '@/store/authStore'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useSocket } from '@/hooks/useSocket'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useActivityTracker } from '@/hooks/useActivityTracker'
import { usePendingCounts } from '@/hooks/usePendingCounts'
import { Bell, Wrench, X as XIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

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

// Invite d'activation des notifications push (UX-06) : proposée sur l'accueil
// seulement, jamais au milieu d'une tâche. « Plus tard » est retenu 30 jours
// sur cet appareil ; l'activation reste possible à tout moment depuis le profil.
const PUSH_DISMISS_KEY = 'sgm-push-dismissed-until'
const PUSH_DISMISS_DAYS = 30

function readPushDismissed(): boolean {
  try {
    const until = Number(localStorage.getItem(PUSH_DISMISS_KEY) ?? 0)
    return until > Date.now()
  } catch { return false }
}

// Mode maintenance (EF-M14-03) : les écritures sont suspendues côté serveur
function MaintenanceBanner() {
  const { data } = useQuery<{ maintenance: boolean; message: string }>({
    queryKey: ['api-status'],
    queryFn: async () => {
      const api = (await import('@/lib/api')).default
      return (await api.get('/status')).data.data
    },
    refetchInterval: 60_000,
  })
  if (!data?.maintenance) return null
  return (
    <div role="status" className="flex items-center gap-2 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 sm:justify-center">
      <Wrench size={14} className="shrink-0" aria-hidden />
      <span>{data.message} Consultation possible, enregistrements suspendus.</span>
    </div>
  )
}

function PushPermissionBanner() {
  const { permission, enable } = usePushNotifications()
  const activeView = useAppStore(state => state.activeView)
  const [dismissed, setDismissed] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDismissed(readPushDismissed()) }, [])

  if (activeView !== 'dashboard') return null
  if (permission === 'unsupported' || permission === 'granted' || dismissed) return null

  const denied = permission === 'denied'

  async function activate() {
    setBusy(true)
    try { await enable() } finally { setBusy(false) }
  }

  function later() {
    try { localStorage.setItem(PUSH_DISMISS_KEY, String(Date.now() + PUSH_DISMISS_DAYS * 86_400_000)) } catch { /* navigation privée */ }
    setDismissed(true)
  }

  return (
    <div role="region" aria-label="Notifications" className="flex items-center gap-2 bg-[#FFF8D6] px-3 py-1.5 text-xs text-[#0F4A0F] sm:justify-center">
      <Bell size={14} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 sm:flex-none">
        {denied
          ? 'Notifications bloquées : autorisez-les dans les réglages du navigateur (cadenas 🔒 à côté de l\'adresse).'
          : 'Soyez alerté des paiements, validations et litiges, même application fermée.'}
      </span>
      {!denied && (
        <button
          onClick={activate}
          disabled={busy}
          className="min-h-[36px] shrink-0 rounded-full bg-[#0F4A0F] px-3 font-bold text-[#F5C400] transition-colors hover:bg-[#1A6B1A] disabled:opacity-50"
        >
          {busy ? 'Activation…' : 'Activer'}
        </button>
      )}
      <button onClick={later} aria-label="Plus tard" title="Plus tard"
        className="-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-[#0F4A0F]/60 transition-colors hover:text-[#0F4A0F]">
        <XIcon size={16} />
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

// Le menu, la barre du haut et les onglets lisent l'écran courant dans le store :
// il suit l'URL (retour arrière, lien direct, rafraîchissement) avant l'affichage.
function useViewFromUrl() {
  const pathname = usePathname()
  useLayoutEffect(() => {
    const view = viewFromPath(pathname)
    if (useAppStore.getState().activeView !== view) useAppStore.setState({ activeView: view, sidebarOpen: false })
  }, [pathname])
}

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  useViewFromUrl()
  usePendingCounts()
  useActivityTracker()
  const { isOffline, queuedCount } = useOfflineSync()
  useSocket()

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <ImpersonationBanner />
        <MaintenanceBanner />
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
    fetchMe().catch((err: { response?: { status?: number } }) => {
      // Ne déconnecter que sur une VRAIE erreur d'authentification (401/403).
      // Un 429 (rate-limit), un 5xx ou une coupure réseau ne doivent jamais
      // détruire la session — c'était la cause des déconnexions intempestives
      // quand le trafic (polling, page publique) dépassait le budget du limiteur.
      const status = err?.response?.status
      if (!cancelled && (status === 401 || status === 403)) {
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
