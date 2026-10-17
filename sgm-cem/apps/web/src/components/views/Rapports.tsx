'use client'
import { useState } from 'react'
import { Download, Eye, FileText, Printer } from 'lucide-react'
import { downloadFromApi, getBaseURL } from '@/lib/api'
import { Button } from '@/components/ui/Button'

// getBaseURL() garantit le suffixe /api quel que soit l'environnement

type ReportKey = 'membres' | 'rubriques' | 'contributions'

export function Rapports() {
  const [loading, setLoading] = useState<ReportKey | 'pdf-view' | 'pdf-download' | null>(null)
  const [error, setError] = useState('')

  // Exports générés par le serveur (toutes les lignes, journalisés)
  async function exportReport(type: ReportKey) {
    setLoading(type)
    setError('')
    try {
      await downloadFromApi(`/exports/${type}.xlsx`, undefined, `${type}.xlsx`)
    } catch {
      setError('Export impossible pour le moment')
    } finally {
      setLoading(null)
    }
  }

  function openFinancialReport(mode: 'view' | 'download') {
    setLoading(mode === 'view' ? 'pdf-view' : 'pdf-download')
    setError('')
    try {
      const url = `${getBaseURL()}/stats/financial-report.pdf${mode === 'download' ? '?download=1' : ''}`
      window.open(url, '_blank')
    } catch {
      setError("Impossible d'ouvrir le rapport PDF.")
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#7C3AED]" />
        <div className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-purple-700">Exports</p>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Rapports</h2>
          <p className="text-gray-500 text-sm mt-0.5">Exports Excel mis en forme et rapport financier PDF, aux couleurs de SGM-CEM.</p>
        </div>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 rounded-[10px] text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <ReportCard
          title="Rapport financier"
          description="Résumé annuel, moyens de paiement, top contributeurs et taux par rubrique — PDF prêt à imprimer."
          icon="print"
        >
          <div className="flex gap-2">
            <Button size="sm" variant="outline" loading={loading === 'pdf-view'} onClick={() => openFinancialReport('view')} className="flex-1">
              <Eye size={13} /> Voir
            </Button>
            <Button size="sm" loading={loading === 'pdf-download'} onClick={() => openFinancialReport('download')} className="flex-1">
              <Download size={13} /> PDF
            </Button>
          </div>
        </ReportCard>
        <ReportCard
          title="Membres"
          description="Liste des membres, groupes, statuts et profils financiers."
        >
          <Button loading={loading === 'membres'} onClick={() => exportReport('membres')} className="w-full">
            <Download size={14} /> Exporter Excel
          </Button>
        </ReportCard>
        <ReportCard
          title="Rubriques"
          description="Rubriques, montants de reference, objectifs et collecte."
        >
          <Button loading={loading === 'rubriques'} onClick={() => exportReport('rubriques')} className="w-full">
            <Download size={14} /> Exporter Excel
          </Button>
        </ReportCard>
        <ReportCard
          title="Contributions"
          description="Historique des contributions avec statut et localisation des fonds."
        >
          <Button loading={loading === 'contributions'} onClick={() => exportReport('contributions')} className="w-full">
            <Download size={14} /> Exporter Excel
          </Button>
        </ReportCard>
      </div>
    </div>
  )
}

function ReportCard({ title, description, icon = 'file', children }: {
  title: string
  description: string
  icon?: 'file' | 'print'
  children: React.ReactNode
}) {
  const Icon = icon === 'print' ? Printer : FileText
  return (
    <div className="bg-white rounded-[18px] border border-gray-100 p-5 hover:shadow-cem-lg hover:-translate-y-0.5 transition-all">
      <div className="w-10 h-10 rounded-[10px] bg-[#E8F5E8] text-[#1A6B1A] flex items-center justify-center mb-4">
        <Icon size={18} />
      </div>
      <h3 className="font-display font-semibold text-[#0F4A0F] text-lg mb-1">{title}</h3>
      <p className="text-sm text-gray-500 mb-5 min-h-15">{description}</p>
      {children}
    </div>
  )
}
