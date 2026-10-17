'use client'
import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { viewFromPath } from '@/lib/view-routing'
import { canAccessView } from '@/lib/navigation'
import dynamic from 'next/dynamic'

// Chaque écran est chargé à la demande : un membre ne télécharge pas le code
// des écrans de trésorerie ou du panneau développeur.
function ViewLoading() {
  return (
    <div className="space-y-3 p-4 lg:p-6" aria-busy="true" aria-label="Chargement">
      <div className="h-7 w-48 animate-pulse rounded-lg bg-gray-100" />
      <div className="h-24 animate-pulse rounded-[18px] bg-gray-100" />
      <div className="h-40 animate-pulse rounded-[18px] bg-gray-100" />
    </div>
  )
}
const loading = ViewLoading

const Dashboard            = dynamic(() => import('@/components/views/Dashboard').then(m => m.Dashboard), { loading })
const DashboardCollecteur  = dynamic(() => import('@/components/views/DashboardCollecteur').then(m => m.DashboardCollecteur), { loading })
const Rubriques            = dynamic(() => import('@/components/views/Rubriques').then(m => m.Rubriques), { loading })
const Contributions        = dynamic(() => import('@/components/views/Contributions').then(m => m.Contributions), { loading })
const Collecteurs          = dynamic(() => import('@/components/views/Collecteurs').then(m => m.Collecteurs), { loading })
const Membres              = dynamic(() => import('@/components/views/Membres').then(m => m.Membres), { loading })
const Validations          = dynamic(() => import('@/components/views/Validations').then(m => m.Validations), { loading })
const TransferValidations  = dynamic(() => import('@/components/views/TransferValidations').then(m => m.TransferValidations), { loading })
const CollectesPubliques   = dynamic(() => import('@/components/views/CollectesPubliques').then(m => m.CollectesPubliques), { loading })
const Litiges              = dynamic(() => import('@/components/views/Litiges').then(m => m.Litiges), { loading })
const Statistiques         = dynamic(() => import('@/components/views/Statistiques').then(m => m.Statistiques), { loading })
const Rapports             = dynamic(() => import('@/components/views/Rapports').then(m => m.Rapports), { loading })
const Notifications        = dynamic(() => import('@/components/views/Notifications').then(m => m.Notifications), { loading })
const Parametres           = dynamic(() => import('@/components/views/Parametres').then(m => m.Parametres), { loading })
const Prestations          = dynamic(() => import('@/components/views/Prestations').then(m => m.Prestations), { loading })
const Ged                  = dynamic(() => import('@/components/views/Ged').then(m => m.Ged), { loading })
const GestionUtilisateurs  = dynamic(() => import('@/components/views/GestionUtilisateurs').then(m => m.GestionUtilisateurs), { loading })
const MesContributions     = dynamic(() => import('@/components/views/MesContributions').then(m => m.MesContributions), { loading })
const RubriquesMembre      = dynamic(() => import('@/components/views/RubriquesMembre').then(m => m.RubriquesMembre), { loading })
const MonProfil            = dynamic(() => import('@/components/views/MonProfil').then(m => m.MonProfil), { loading })
const Developer            = dynamic(() => import('@/components/views/Developer').then(m => m.Developer), { loading })
const Journal              = dynamic(() => import('@/components/views/Journal').then(m => m.Journal), { loading })
const Observabilite        = dynamic(() => import('@/components/views/Observabilite').then(m => m.Observabilite), { loading })


function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center p-6 animate-page-enter">
      <div className="w-20 h-20 bg-red-50 rounded-[20px] flex items-center justify-center text-3xl">🔒</div>
      <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Accès restreint</h2>
      <p className="text-gray-400 text-sm max-w-xs">
        Vous n&apos;avez pas les droits nécessaires pour accéder à cette section.
        Contactez votre administrateur si vous pensez que c&apos;est une erreur.
      </p>
    </div>
  )
}

export default function AppPage() {
  // Écran dérivé de l'URL (et non d'un état en mémoire) : retour arrière et rafraîchissement fiables
  const activeView = viewFromPath(usePathname())
  const { user } = useAuthStore()
  const role = user?.role

  // Droits d'accès : table unique (lib/navigation.ts), celle du menu et des onglets
  if (!canAccessView(activeView, role)) return <AccessDenied />

  // Accueil et vues propres à certains rôles
  if (role === 'MEMBRE') {
    if (activeView === 'dashboard' || activeView === 'mes-contributions') return <MesContributions />
    if (activeView === 'rubriques') return <RubriquesMembre />
  }
  if (activeView === 'dashboard') return role === 'COLLECTEUR' ? <DashboardCollecteur /> : <Dashboard />

  const View = VIEWS[activeView]
  return View ? <View /> : <AccessDenied />
}

const VIEWS: Record<string, React.ComponentType> = {
  rubriques: Rubriques,
  contributions: Contributions,
  membres: Membres,
  collecteurs: Collecteurs,
  validations: Validations,
  'transfer-validations': TransferValidations,
  'collectes-publiques': CollectesPubliques,
  ged: Ged,
  prestations: Prestations,
  litiges: Litiges,
  statistiques: Statistiques,
  rapports: Rapports,
  notifications: Notifications,
  journal: Journal,
  observabilite: Observabilite,
  parametres: Parametres,
  utilisateurs: GestionUtilisateurs,
  developer: Developer,
  'mon-profil': MonProfil,
  'mes-contributions': MesContributions,
}
