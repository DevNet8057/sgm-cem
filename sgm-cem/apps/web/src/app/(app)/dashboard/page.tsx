'use client'
import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { viewFromPath } from '@/lib/view-routing'
import { canAccessView } from '@/lib/navigation'

import { Dashboard }            from '@/components/views/Dashboard'
import { DashboardCollecteur }  from '@/components/views/DashboardCollecteur'
import { Rubriques }            from '@/components/views/Rubriques'
import { Contributions }        from '@/components/views/Contributions'
import { Collecteurs }          from '@/components/views/Collecteurs'
import { Membres }              from '@/components/views/Membres'
import { Validations }          from '@/components/views/Validations'
import { TransferValidations }  from '@/components/views/TransferValidations'
import { CollectesPubliques }   from '@/components/views/CollectesPubliques'
import { Litiges }              from '@/components/views/Litiges'
import { Statistiques }         from '@/components/views/Statistiques'
import { Rapports }             from '@/components/views/Rapports'
import { Notifications }        from '@/components/views/Notifications'
import { Parametres }           from '@/components/views/Parametres'
import { Prestations }          from '@/components/views/Prestations'
import { Ged }                  from '@/components/views/Ged'
import { GestionUtilisateurs }  from '@/components/views/GestionUtilisateurs'
import { MesContributions }     from '@/components/views/MesContributions'
import { RubriquesMembre }      from '@/components/views/RubriquesMembre'
import { MonProfil }            from '@/components/views/MonProfil'
import { Developer }            from '@/components/views/Developer'
import { Journal }              from '@/components/views/Journal'
import { Observabilite }        from '@/components/views/Observabilite'

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

const VIEWS: Record<string, () => React.JSX.Element | null> = {
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
