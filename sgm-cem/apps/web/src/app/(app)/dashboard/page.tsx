'use client'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { ROLE_LEVELS } from '@/lib/utils'

import { Dashboard }            from '@/components/views/Dashboard'
import { DashboardCollecteur }  from '@/components/views/DashboardCollecteur'
import { Rubriques }            from '@/components/views/Rubriques'
import { Contributions }        from '@/components/views/Contributions'
import { Collecteurs }          from '@/components/views/Collecteurs'
import { Membres }              from '@/components/views/Membres'
import { Validations }          from '@/components/views/Validations'
import { TransferValidations }  from '@/components/views/TransferValidations'
import { Litiges }              from '@/components/views/Litiges'
import { Statistiques }         from '@/components/views/Statistiques'
import { Rapports }             from '@/components/views/Rapports'
import { Notifications }        from '@/components/views/Notifications'
import { Parametres }           from '@/components/views/Parametres'
import { Prestations }          from '@/components/views/Prestations'
import { Ged }                  from '@/components/views/Ged'
import { GestionUtilisateurs }  from '@/components/views/GestionUtilisateurs'
import { MesContributions }     from '@/components/views/MesContributions'
import { MonProfil }            from '@/components/views/MonProfil'
import { Developer }            from '@/components/views/Developer'

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center p-6 animate-page-enter">
      <div className="w-20 h-20 bg-red-50 rounded-[20px] flex items-center justify-center text-3xl">🔒</div>
      <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Accès restreint</h2>
      <p className="text-gray-400 text-sm max-w-xs">
        Vous n'avez pas les droits nécessaires pour accéder à cette section.
        Contactez votre administrateur si vous pensez que c'est une erreur.
      </p>
    </div>
  )
}

export default function AppPage() {
  const { activeView } = useAppStore()
  const { user } = useAuthStore()
  const level = ROLE_LEVELS[user?.role ?? ''] ?? 1
  const isAdmin  = user?.role === 'ADMIN' || user?.role === 'DEVELOPER'
  const isMembre = user?.role === 'MEMBRE'

  // MEMBRE : interface simplifiée
  if (isMembre) {
    switch (activeView) {
      case 'mes-contributions':
      case 'dashboard':     return <MesContributions />
      case 'notifications': return <Notifications />
      case 'mon-profil':    return <MonProfil />
      default:              return <MesContributions />
    }
  }

  // COLLECTEUR : interface limitée
  if (user?.role === 'COLLECTEUR') {
    switch (activeView) {
      case 'dashboard':     return <DashboardCollecteur />
      case 'contributions': return <Contributions />
      case 'collecteurs':   return <Collecteurs />
      case 'notifications': return <Notifications />
      case 'mon-profil':    return <MonProfil />
      default:              return <DashboardCollecteur />
    }
  }

  // Vues avec contrôle d'accès par niveau
  switch (activeView) {
    case 'dashboard':            return <Dashboard />
    case 'rubriques':            return level >= 1 ? <Rubriques />  : <AccessDenied />
    case 'contributions':        return level >= 2 ? <Contributions /> : <AccessDenied />
    case 'membres':              return level >= 2 ? <Membres />    : <AccessDenied />
    case 'collecteurs':          return level >= 3 ? <Collecteurs /> : <AccessDenied />
    case 'validations':          return level >= 2 ? <Validations /> : <AccessDenied />
    case 'transfer-validations': return level >= 2 ? <TransferValidations /> : <AccessDenied />
    case 'ged':                  return level >= 2 ? <Ged />        : <AccessDenied />
    case 'prestations':          return level >= 2 ? <Prestations /> : <AccessDenied />
    case 'litiges':              return level >= 3 ? <Litiges />    : <AccessDenied />
    case 'statistiques':         return level >= 3 ? <Statistiques /> : <AccessDenied />
    case 'rapports':             return level >= 3 ? <Rapports />   : <AccessDenied />
    case 'notifications':        return <Notifications />
    case 'parametres':           return level >= 5 ? <Parametres /> : <AccessDenied />
    case 'utilisateurs':         return isAdmin     ? <GestionUtilisateurs /> : <AccessDenied />
    // Panneau développeur — rôle DEVELOPER EXACT (jamais ADMIN, jamais level >= 5)
    case 'developer':            return user?.role === 'DEVELOPER' ? <Developer /> : <AccessDenied />
    case 'mon-profil':           return <MonProfil />
    default:                     return <Dashboard />
  }
}
