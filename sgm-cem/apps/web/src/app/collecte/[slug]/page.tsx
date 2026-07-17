'use client'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { PublicCollecteStepper } from '@/components/public/PublicCollecteStepper'
import type { CollectePubliqueDef } from '@sgm-cem/shared'

// Page publique — accessible sans authentification, hors du groupe (app).
// Le slug vient de la route dynamique : params est une Promise côté server
// component, mais ici la page est CLIENT et utilise useParams() (pas de
// useSearchParams, donc pas de boundary <Suspense> nécessaire ici).
export default function CollectePubliquePage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug

  const { data, isLoading, isError } = useQuery<CollectePubliqueDef>({
    queryKey: ['collecte-publique', slug],
    queryFn: async () => (await api.get(`/public/collectes/${slug}`)).data.data,
    enabled: !!slug,
    retry: false,
  })

  if (isLoading) {
    return (
      <BrandedShell>
        <div className="p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto animate-pulse">
            <Loader2 size={28} className="text-blue-500 animate-spin" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-xl mb-1">Chargement…</h2>
            <p className="text-sm text-gray-500">Récupération de la collecte.</p>
          </div>
        </div>
      </BrandedShell>
    )
  }

  if (isError || !data) {
    return (
      <BrandedShell>
        <div className="p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <AlertCircle size={28} className="text-red-500" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-red-700 text-xl mb-1">Collecte introuvable</h2>
            <p className="text-sm text-gray-500">
              Collecte introuvable ou fermée. Vérifiez le lien reçu ou contactez l&apos;organisateur.
            </p>
          </div>
        </div>
      </BrandedShell>
    )
  }

  return <PublicCollecteStepper collecte={data} slug={slug} />
}

/** Coque visuelle réutilisée pour les états chargement/erreur — même branding que /payment/return. */
function BrandedShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F8FAF8] flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-[24px] shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gradient-to-br from-[#052005] to-[#1A6B1A] px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-[#F5C400] flex items-center justify-center">
            <span className="text-[#0F4A0F] font-black text-sm font-display">CEM</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">SGM-CEM</p>
            <p className="text-white/60 text-xs">Collecte publique</p>
          </div>
        </div>

        {children}

        <div className="px-6 pb-5 text-center">
          <p className="text-[10px] text-gray-400">
            SGM-CEM · Culte d&apos;Enfants de Melen · EEC Yaoundé
          </p>
        </div>
      </div>
    </div>
  )
}
