'use client'
import { useState } from 'react'
import { Download, Eye, FileText, Printer } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { downloadXlsx } from '@/lib/exportXlsx'
import type { Contribution, Membre, Rubrique } from '@/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api'

type ReportKey = 'membres' | 'rubriques' | 'contributions'

export function Rapports() {
  const [loading, setLoading] = useState<ReportKey | 'pdf-view' | 'pdf-download' | null>(null)
  const [error, setError] = useState('')

  async function exportReport(type: ReportKey) {
    setLoading(type)
    setError('')
    try {
      if (type === 'membres') {
        const rows = (await api.get('/membres', { params: { limit: 500 } })).data.data as Membre[]
        await downloadXlsx({
          filename: 'membres.xlsx',
          sheetName: 'Membres',
          title: 'Liste des membres',
          columns: [
            { header: 'Matricule', key: 'matricule', width: 16 },
            { header: 'Nom', key: 'nom', width: 26 },
            { header: 'Email', key: 'email', width: 26 },
            { header: 'Téléphone', key: 'phone', width: 16 },
            { header: 'Catégorie', key: 'categorie', width: 16 },
            { header: 'Groupe', key: 'groupe', width: 16 },
            { header: 'Statut', key: 'statut', width: 16 },
            { header: 'Profil financier', key: 'profil', width: 16 },
            { header: 'Date adhésion', key: 'adhesion', width: 16 },
          ],
          rows: rows.map(m => ({
            matricule: m.memberId, nom: m.user.fullName, email: m.user.email, phone: m.phone ?? '',
            categorie: m.categorie, groupe: m.groupe, statut: m.statut, profil: m.profilFinancier,
            adhesion: formatDate(m.dateAdhesion),
          })),
        })
      }

      if (type === 'rubriques') {
        const rows = (await api.get('/rubriques')).data.data as Rubrique[]
        await downloadXlsx({
          filename: 'rubriques.xlsx',
          sheetName: 'Rubriques',
          title: 'Rubriques budgétaires',
          columns: [
            { header: 'Code', key: 'code', width: 14 },
            { header: 'Titre', key: 'titre', width: 30 },
            { header: 'Type', key: 'type', width: 14 },
            { header: 'Priorité', key: 'priorite', width: 12 },
            { header: 'Statut', key: 'statut', width: 12 },
            { header: 'Année', key: 'annee', width: 10 },
            { header: 'Travailleur', key: 'travailleur', width: 14, type: 'number' },
            { header: 'Étudiant', key: 'etudiant', width: 14, type: 'number' },
            { header: 'Couple', key: 'couple', width: 14, type: 'number' },
            { header: 'Objectif', key: 'objectif', width: 14, type: 'number' },
            { header: 'Collecte', key: 'collecte', width: 14, type: 'number' },
            { header: 'Contributions', key: 'nb', width: 14, type: 'number' },
          ],
          rows: rows.map(r => ({
            code: r.code, titre: r.title, type: r.type, priorite: r.priority, statut: r.status, annee: r.fiscalYear,
            travailleur: r.amountTravailleur ?? 0, etudiant: r.amountEtudiant ?? 0, couple: r.amountCouple ?? 0,
            objectif: r.targetAmount ?? 0, collecte: r.totalCollecte ?? 0, nb: r.nbContributions ?? 0,
          })),
        })
      }

      if (type === 'contributions') {
        const rows = (await api.get('/contributions', { params: { limit: 500 } })).data.data as Contribution[]
        await downloadXlsx({
          filename: 'contributions.xlsx',
          sheetName: 'Contributions',
          title: 'Historique des contributions',
          columns: [
            { header: 'Membre', key: 'membre', width: 26 },
            { header: 'Rubrique', key: 'rubrique', width: 16 },
            { header: 'Montant', key: 'montant', width: 16, type: 'number' },
            { header: 'Mode', key: 'mode', width: 16 },
            { header: 'Statut', key: 'statut', width: 20 },
            { header: 'Localisation', key: 'localisation', width: 18 },
            { header: 'Date', key: 'date', width: 16 },
          ],
          rows: rows.map(c => ({
            membre: c.membre?.user.fullName ?? '',
            rubrique: c.rubrique?.code ?? '',
            montant: c.montant,
            mode: c.modePaiement,
            statut: c.statut,
            localisation: c.localisationFonds ?? '',
            date: formatDate(c.createdAt),
          })),
        })
      }
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
      const url = `${API_URL}/stats/financial-report.pdf${mode === 'download' ? '?download=1' : ''}`
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
          <p className="text-xs font-bold uppercase tracking-widest text-purple-600">Exports</p>
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
