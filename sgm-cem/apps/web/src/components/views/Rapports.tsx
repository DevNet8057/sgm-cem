'use client'
import { useState } from 'react'
import { Download, FileText, Printer } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { formatAmount, formatDate, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import type { Contribution, DashboardStats, Membre, Rubrique } from '@/types'

type ReportKey = 'membres' | 'rubriques' | 'contributions'

export function Rapports() {
  const [loading, setLoading] = useState<ReportKey | 'pdf' | null>(null)
  const [error, setError] = useState('')

  async function exportReport(type: ReportKey) {
    setLoading(type)
    setError('')
    try {
      if (type === 'membres') {
        const rows = (await api.get('/membres', { params: { limit: 500 } })).data.data as Membre[]
        downloadCsv('membres.csv', [
          ['Matricule', 'Nom', 'Email', 'Telephone', 'Categorie', 'Groupe', 'Statut', 'Profil financier', 'Date adhesion'],
          ...rows.map(m => [m.memberId, m.user.fullName, m.user.email, m.phone ?? '', m.categorie, m.groupe, m.statut, m.profilFinancier, formatDate(m.dateAdhesion)]),
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
            formatDate(c.createdAt),
          ]),
        ])
      }
    } catch {
      setError('Export impossible pour le moment')
    } finally {
      setLoading(null)
    }
  }

  async function printFinancialReport() {
    setLoading('pdf')
    setError('')
    try {
      const stats = (await api.get('/stats/dashboard')).data.data as DashboardStats
      const html = buildFinancialReport(stats)
      const popup = window.open('', '_blank', 'width=1100,height=800')
      if (!popup) throw new Error('Popup bloquee par le navigateur. Autorisez les popups pour localhost.')
      popup.document.open()
      popup.document.write(html)
      popup.document.close()
      popup.focus()
      // L'impression est déclenchée depuis le popup lui-même via onload pour éviter le blocage cross-origin
      setTimeout(() => popup.postMessage({ type: 'sgm-cem-print' }, '*'), 50)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Impossible d'ouvrir le rapport PDF."
      setError(message)
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
          <p className="text-gray-500 text-sm mt-0.5">Exports CSV et rapport financier imprimable en PDF.</p>
        </div>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 rounded-[10px] text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <ReportCard
          title="Rapport financier"
          description="Résumé annuel, moyens de paiement, top contributeurs et taux par rubrique."
          loading={loading === 'pdf'}
          icon="print"
          actionLabel="Imprimer / PDF"
          onExport={printFinancialReport}
        />
        <ReportCard
          title="Membres"
          description="Liste des membres, groupes, statuts et profils financiers."
          loading={loading === 'membres'}
          actionLabel="Exporter CSV"
          onExport={() => exportReport('membres')}
        />
        <ReportCard
          title="Rubriques"
          description="Rubriques, montants de reference, objectifs et collecte."
          loading={loading === 'rubriques'}
          actionLabel="Exporter CSV"
          onExport={() => exportReport('rubriques')}
        />
        <ReportCard
          title="Contributions"
          description="Historique des contributions avec statut et localisation des fonds."
          loading={loading === 'contributions'}
          actionLabel="Exporter CSV"
          onExport={() => exportReport('contributions')}
        />
      </div>
    </div>
  )
}

function ReportCard({ title, description, loading, icon = 'file', actionLabel, onExport }: {
  title: string
  description: string
  loading: boolean
  icon?: 'file' | 'print'
  actionLabel: string
  onExport: () => void
}) {
  const Icon = icon === 'print' ? Printer : FileText
  return (
    <div className="bg-white rounded-[18px] border border-gray-100 p-5 hover:shadow-cem-lg hover:-translate-y-0.5 transition-all">
      <div className="w-10 h-10 rounded-[10px] bg-[#E8F5E8] text-[#1A6B1A] flex items-center justify-center mb-4">
        <Icon size={18} />
      </div>
      <h3 className="font-display font-semibold text-[#0F4A0F] text-lg mb-1">{title}</h3>
      <p className="text-sm text-gray-500 mb-5 min-h-15">{description}</p>
      <Button loading={loading} onClick={onExport}>
        <Download size={14} />
        {actionLabel}
      </Button>
    </div>
  )
}

function amount(value?: number): string {
  return value == null ? '' : formatAmount(value)
}

function buildFinancialReport(stats: DashboardStats): string {
  const topContributors = stats.topContributors.map((item, index) => `
    <tr><td>${index + 1}</td><td>${escapeHtml(item.fullName)}</td><td>${item.count}</td><td>${formatAmount(item.total)}</td></tr>
  `).join('')

  const paymentModes = stats.modePaiementStats.map(item => `
    <tr><td>${MODE_PAIEMENT_LABELS[item.modePaiement]}</td><td>${item.count}</td><td>${formatAmount(item.total)}</td><td>${item.share}%</td></tr>
  `).join('')

  const rates = stats.contributionRates.map(item => `
    <tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.title)}</td><td>${formatAmount(item.total)}</td><td>${item.rate == null ? 'Libre' : `${item.rate}%`}</td></tr>
  `).join('')

  return `
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Rapport financier SGM-CEM</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0F172A; margin: 0; background: #fff; }
    header { border-left: 8px solid #F5C400; padding: 18px 22px; background: #0F4A0F; color: white; border-radius: 10px; }
    h1 { margin: 0; font-size: 26px; }
    h2 { color: #0F4A0F; font-size: 18px; margin: 28px 0 10px; }
    .muted { color: #64748B; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 18px; }
    .kpi { border: 1px solid #DDE7DD; border-radius: 10px; padding: 12px; }
    .kpi span { display: block; font-size: 11px; color: #64748B; }
    .kpi strong { display: block; font-size: 17px; color: #0F4A0F; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th { text-align: left; background: #E8F5E8; color: #0F4A0F; }
    th, td { border: 1px solid #E2E8F0; padding: 8px; }
    footer { margin-top: 32px; font-size: 11px; color: #64748B; }
  </style>
</head>
<body>
  <header>
    <h1>Rapport financier SGM-CEM</h1>
    <p>Culte d'Enfants de Melen - Exercice ${stats.year}</p>
  </header>

  <section class="grid">
    <div class="kpi"><span>Membres actifs</span><strong>${stats.totalMembres}</strong></div>
    <div class="kpi"><span>Collecte annuelle</span><strong>${formatAmount(stats.totalCollectedYear)}</strong></div>
    <div class="kpi"><span>Ce mois</span><strong>${formatAmount(stats.totalCollectedMonth)}</strong></div>
    <div class="kpi"><span>Taux confirmation</span><strong>${stats.globalConfirmationRate}%</strong></div>
  </section>

  <h2>Lecture rapide</h2>
  <p>Le moyen de contribution le plus utilise est <strong>${stats.mostUsedPaymentMode ? MODE_PAIEMENT_LABELS[stats.mostUsedPaymentMode.modePaiement] : '-'}</strong>.</p>
  <p>Le plus grand contributeur est <strong>${escapeHtml(stats.topContributor?.fullName ?? '-')}</strong> avec <strong>${formatAmount(stats.topContributor?.total ?? 0)}</strong>.</p>

  <h2>Moyens de contribution</h2>
  <table><thead><tr><th>Mode</th><th>Nombre</th><th>Montant</th><th>Part</th></tr></thead><tbody>${paymentModes || '<tr><td colspan="4">Aucune donnee</td></tr>'}</tbody></table>

  <h2>Top contributeurs</h2>
  <table><thead><tr><th>#</th><th>Membre</th><th>Nombre</th><th>Total</th></tr></thead><tbody>${topContributors || '<tr><td colspan="4">Aucune donnee</td></tr>'}</tbody></table>

  <h2>Taux par rubrique</h2>
  <table><thead><tr><th>Code</th><th>Rubrique</th><th>Collecte</th><th>Taux</th></tr></thead><tbody>${rates || '<tr><td colspan="4">Aucune donnee</td></tr>'}</tbody></table>

  <footer>Genere le ${new Date().toLocaleString('fr-FR')} depuis SGM-CEM.</footer>

  <script>
    window.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'sgm-cem-print') {
        event.target.print()
      }
    })
  </script>
</body>
</html>`
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
