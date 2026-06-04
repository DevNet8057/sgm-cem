'use client'
import { useAppStore } from '@/store/appStore'
import { Dashboard } from '@/components/views/Dashboard'
import { Rubriques } from '@/components/views/Rubriques'
import { Contributions } from '@/components/views/Contributions'
import { Collecteurs } from '@/components/views/Collecteurs'
import { Membres } from '@/components/views/Membres'
import { Validations } from '@/components/views/Validations'
import { Litiges } from '@/components/views/Litiges'
import { Statistiques } from '@/components/views/Statistiques'
import { Rapports } from '@/components/views/Rapports'
import { Placeholder } from '@/components/views/Placeholder'

export default function AppPage() {
  const { activeView } = useAppStore()

  switch (activeView) {
    case 'dashboard':     return <Dashboard />
    case 'rubriques':     return <Rubriques />
    case 'contributions': return <Contributions />
    case 'membres':       return <Membres />
    case 'collecteurs':   return <Collecteurs />
    case 'validations':   return <Validations />
    case 'ged':           return <Placeholder title="GED Commissions" />
    case 'prestations':   return <Placeholder title="Prestations de Génie" />
    case 'litiges':       return <Litiges />
    case 'statistiques':  return <Statistiques />
    case 'rapports':      return <Rapports />
    case 'notifications': return <Placeholder title="Notifications" />
    case 'parametres':    return <Placeholder title="Paramètres" />
    default:              return <Dashboard />
  }
}
