'use client'

import { Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import api from '@/lib/api'
import { BrandMark } from '@/components/ui/BrandMark'
import { formatAmount, formatDate } from '@/lib/utils'

// Page publique ouverte par le code QR d'un document (reçu, facture, avis,
// bordereau). Elle n'affiche que des données minimales : montant, date,
// statut et initiales du payeur.
interface Verification {
  type: string
  numero: string
  communaute: string
  montant: number
  date: string
  statut: string
  objet: string
  payeur: string | null
}

const STATUTS: Record<string, string> = {
  CONFIRME: 'Confirmé', EN_ATTENTE: 'En attente', ANNULE: 'Annulé', REJETE: 'Refusé',
  ACQUITTEE: 'Acquittée', A_REGLER: 'À régler',
  DEMANDE: 'Demandé', VALIDE: 'Visé', EXECUTE: 'Remboursé',
  PENDING: 'En attente', CONFIRMED: 'Reçu', REJECTED: 'Refusé', CANCELLED: 'Annulé',
}

export default function VerifierPage() {
  return (
    <Suspense fallback={<Shell><Loading /></Shell>}>
      <Verifier />
    </Suspense>
  )
}

function Verifier() {
  const { type, id } = useParams<{ type: string; id: string }>()
  const signature = useSearchParams().get('s') ?? ''
  const { data, isLoading, isError } = useQuery<Verification>({
    queryKey: ['verifier', type, id, signature],
    queryFn: async () => (await api.get(`/public/verifier/${type}/${id}`, { params: { s: signature } })).data.data,
    enabled: !!type && !!id,
    retry: false,
  })

  if (isLoading) return <Shell><Loading /></Shell>
  if (isError || !data) {
    return (
      <Shell>
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600"><ShieldAlert size={28} /></span>
          <h1 className="font-display text-xl font-semibold text-red-700">Document non authentifié</h1>
          <p className="text-sm text-gray-600">
            Ce lien ne correspond à aucun document émis par SGM-CEM, ou il a été modifié.
            Ne vous fiez pas à ce document et contactez la trésorerie de la communauté.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex flex-col items-center text-center gap-2">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E8F5E8] text-[#1A6B1A]"><CheckCircle2 size={28} /></span>
        <h1 className="font-display text-xl font-semibold text-[#0F4A0F]">Document authentique</h1>
        <p className="text-sm text-gray-500">Émis par {data.communaute}</p>
      </div>
      <dl className="mt-6 divide-y divide-gray-100 rounded-[14px] border border-gray-100 text-sm">
        <Row label="Document" value={data.type} />
        <Row label="Numéro" value={<span className="font-mono">{data.numero}</span>} />
        <Row label="Objet" value={data.objet} />
        <Row label="Montant" value={<strong className="text-[#0F4A0F]">{formatAmount(data.montant)}</strong>} />
        <Row label="Date" value={formatDate(data.date)} />
        <Row label="Statut" value={STATUTS[data.statut] ?? data.statut} />
        {data.payeur && <Row label="Concerne" value={data.payeur} />}
      </dl>
      <p className="mt-4 text-xs text-gray-400 text-center">
        Comparez ces informations avec le document papier : elles doivent être identiques.
      </p>
    </Shell>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right text-gray-800">{value}</dd>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500" aria-busy="true">
      <Loader2 size={16} className="animate-spin" /> Vérification du document…
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-[#f3f7f3] px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-md">
        <div className="mb-5 flex items-center justify-center gap-2">
          <BrandMark size={40} decorative />
          <span className="font-display font-semibold text-[#0F4A0F]">Vérification de document</span>
        </div>
        <section className="rounded-[18px] border border-gray-100 bg-white p-6 shadow-sm">{children}</section>
      </div>
    </main>
  )
}
