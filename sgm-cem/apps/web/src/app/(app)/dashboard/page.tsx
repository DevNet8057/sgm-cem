'use client'
import dynamic from 'next/dynamic'
import { Card, Skeleton } from 'antd'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { canAccessView, getNavigationForRole, type ViewId } from '@/config/navigation'

function ViewLoading() {
  return (
    <div
      className="p-4 md:p-6 xl:p-8 animate-page-enter"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Chargement de la vue…</span>
      <Card
        variant="borderless"
        className="min-h-[420px] border border-white/[.06] bg-[#0E1C16] shadow-[0_8px_30px_rgba(0,0,0,.25)]"
      >
        <Skeleton
          active
          title={{ width: '38%' }}
          paragraph={{ rows: 8, width: ['100%', '92%', '96%', '82%', '100%', '88%', '94%', '70%'] }}
        />
      </Card>
    </div>
  )
}

const Dashboard = dynamic(
  () => import('@/components/views/Dashboard').then(module => module.Dashboard),
  { loading: ViewLoading },
)
const DashboardCollecteur = dynamic(
  () => import('@/components/views/DashboardCollecteur').then(module => module.DashboardCollecteur),
  { loading: ViewLoading },
)
const Rubriques = dynamic(
  () => import('@/components/views/Rubriques').then(module => module.Rubriques),
  { loading: ViewLoading },
)
const Contributions = dynamic(
  () => import('@/components/views/Contributions').then(module => module.Contributions),
  { loading: ViewLoading },
)
const Collecteurs = dynamic(
  () => import('@/components/views/Collecteurs').then(module => module.Collecteurs),
  { loading: ViewLoading },
)
const Membres = dynamic(
  () => import('@/components/views/Membres').then(module => module.Membres),
  { loading: ViewLoading },
)
const Validations = dynamic(
  () => import('@/components/views/Validations').then(module => module.Validations),
  { loading: ViewLoading },
)
const TransferValidations = dynamic(
  () => import('@/components/views/TransferValidations').then(module => module.TransferValidations),
  { loading: ViewLoading },
)
const CollectesPubliques = dynamic(
  () => import('@/components/views/CollectesPubliques').then(module => module.CollectesPubliques),
  { loading: ViewLoading },
)
const Litiges = dynamic(
  () => import('@/components/views/Litiges').then(module => module.Litiges),
  { loading: ViewLoading },
)
const Statistiques = dynamic(
  () => import('@/components/views/Statistiques').then(module => module.Statistiques),
  { loading: ViewLoading },
)
const Rapports = dynamic(
  () => import('@/components/views/Rapports').then(module => module.Rapports),
  { loading: ViewLoading },
)
const Notifications = dynamic(
  () => import('@/components/views/Notifications').then(module => module.Notifications),
  { loading: ViewLoading },
)
const Parametres = dynamic(
  () => import('@/components/views/Parametres').then(module => module.Parametres),
  { loading: ViewLoading },
)
const Prestations = dynamic(
  () => import('@/components/views/Prestations').then(module => module.Prestations),
  { loading: ViewLoading },
)
const Ged = dynamic(
  () => import('@/components/views/Ged').then(module => module.Ged),
  { loading: ViewLoading },
)
const GestionUtilisateurs = dynamic(
  () => import('@/components/views/GestionUtilisateurs').then(module => module.GestionUtilisateurs),
  { loading: ViewLoading },
)
const MesContributions = dynamic(
  () => import('@/components/views/MesContributions').then(module => module.MesContributions),
  { loading: ViewLoading },
)
const MonProfil = dynamic(
  () => import('@/components/views/MonProfil').then(module => module.MonProfil),
  { loading: ViewLoading },
)
const Developer = dynamic(
  () => import('@/components/views/Developer').then(module => module.Developer),
  { loading: ViewLoading },
)
const Journal = dynamic(
  () => import('@/components/views/Journal').then(module => module.Journal),
  { loading: ViewLoading },
)

export default function AppPage() {
  const { activeView } = useAppStore()
  const { user } = useAuthStore()
  if (!user) return <ViewLoading />

  const requestedView = activeView as ViewId
  const safeActiveView = canAccessView(user.role, requestedView)
    ? requestedView
    : getNavigationForRole(user.role)[0]?.id ?? 'mon-profil'

  // Le contrôle d'accès est centralisé dans config/navigation.ts.
  // Ce switch ne fait qu'associer une vue déjà autorisée à son composant.
  switch (safeActiveView) {
    case 'dashboard':            return user.role === 'COLLECTEUR' ? <DashboardCollecteur /> : <Dashboard />
    case 'rubriques':            return <Rubriques />
    case 'contributions':        return <Contributions />
    case 'collecteurs':          return <Collecteurs />
    case 'validations':          return <Validations />
    case 'transfer-validations': return <TransferValidations />
    case 'collectes-publiques':  return <CollectesPubliques />
    case 'membres':              return <Membres />
    case 'mes-contributions':    return <MesContributions />
    case 'ged':                  return <Ged />
    case 'prestations':          return <Prestations />
    case 'litiges':              return <Litiges />
    case 'statistiques':         return <Statistiques />
    case 'rapports':             return <Rapports />
    case 'notifications':        return <Notifications />
    case 'journal':              return <Journal />
    case 'parametres':           return <Parametres />
    case 'utilisateurs':         return <GestionUtilisateurs />
    case 'developer':            return <Developer />
    case 'mon-profil':           return <MonProfil />
    default:                     return <ViewLoading />
  }
}
