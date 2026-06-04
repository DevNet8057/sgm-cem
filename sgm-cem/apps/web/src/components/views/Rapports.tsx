'use client'
import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { formatAmount } from '@/lib/utils'
import type { Contribution, Membre, Rubrique } from '@/types'

type ReportKey = 'membres' | 'rubriques' | 'contributions'

export function Rapports() {
  const [loading, setLoading] = useState<ReportKey | null>(null)
  const [error, setError] = useState('')

  async function exportReport(type: ReportKey) {
    setLoading(type)
    setError('')
    try {
      if (type === 'membres') {
        const rows = (await api.get('/membres', { params: { limit: 500 } })).data.data as Membre[]
        downloadCsv('membres.csv', [
          ['Matricule', 'Nom', 'Email', 'Telephone', 'Categorie', 'Groupe', 'Statut', 'Profil financier', 'Date adhesion'],
          ...rows.map(m => [m.memberId, m.user.fullName, m.user.email, m.phone ?? '', m.categorie, m.groupe, m.statut, m.profilFinancier, m.dateAdhesion]),
        ])
      }

      if (type === 'rubriques') {
        const rows = (await api.get('/rubriques')).data.data as Rubrique[]
        downloadCsv('rubriques.csv', [
          ['Code', 'Titre', 'Type', 'Priorite', 'Statut', 'Annee', 'Travailleur', 'Etudiant', 'Couple', 'Objectif', 'Collecte', 'Contributions'],
          ...rows.map(r => [
            r.code, r.title, r.type, r.priority, r.status, String(r.fiscalYear),
            amount(r.amountTravailleur), amount(r.amountEtudiant), amount(r.amountCouple),
            amount(r.targetAmount), amount(r.totalCollecte), String(r.nbContributions ?? 0)
          ]),
        ])
      }

      if (type === 'contributions') {
        const rows = (await api.get('/contributions', { params: { limit: 500 } })).data.data as Contribution[]
        downloadCsv('contributions.csv', [
          ['Membre', 'Rubrique', 'Montant', 'Mode', 'Statut', 'Localisation', 'Date'],
          ...rows.map(c => [
            c.membre?.user.fullName ?? '',
            c.rubrique?.code ?? '',
            amount(c.montant),
            c.modePaiement,
            c.statut,
            c.localisationFonds ?? '',
            c.createdAt,
          ]),
        ])
      }
    } catch {
      setError('Export impossible pour le moment')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="mb-6">
        <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Rapports</h2>
        <p className="text-gray-500 text-sm">Exports CSV pour verification, partage et archivage.</p>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 rounded-[10px] text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ReportCard
          title="Membres"
          description="Liste des membres, groupes, statuts et profils financiers."
          loading={loading === 'membres'}
          onExport={() => exportReport('membres')}
        />
        <ReportCard
          title="Rubriques"
          description="Rubriques, montants de reference, objectifs et collecte."
          loading={loading === 'rubriques'}
          onExport={() => exportReport('rubriques')}
        />
        <ReportCard
          title="Contributions"
          description="Historique des contributions avec statut et localisation des fonds."
          loading={loading === 'contributions'}
          onExport={() => exportReport('contributions')}
        />
      </div>
    </div>
  )
}

function ReportCard({ title, description, loading, onExport }: {
  title: string
  description: string
  loading: boolean
  onExport: () => void
}) {
  return (
    <div className="bg-white rounded-[18px] border border-gray-100 p-5">
      <div className="w-10 h-10 rounded-[10px] bg-[#E8F5E8] text-[#1A6B1A] flex items-center justify-center mb-4">
        <FileText size={18} />
      </div>
      <h3 className="font-display font-semibold text-[#0F4A0F] text-lg mb-1">{title}</h3>
      <p className="text-sm text-gray-500 mb-5">{description}</p>
      <Button loading={loading} onClick={onExport}>
        <Download size={14} />
        Exporter CSV
      </Button>
    </div>
  )
}

function amount(value?: number): string {
  return value == null ? '' : formatAmount(value)
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(row => row.map(escapeCsv).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}
