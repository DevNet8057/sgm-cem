'use client'

import type { ReactNode } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Alert, Card, Result, Skeleton, Typography } from 'antd'
import { motion, useReducedMotion } from 'framer-motion'
import api from '@/lib/api'
import { PublicCollecteStepper } from '@/components/public/PublicCollecteStepper'
import { BrandMark } from '@/components/ui/BrandMark'
import type { CollectePubliqueDef } from '@sgm-cem/shared'

// Page publique accessible sans authentification, hors du groupe (app).
export default function CollectePubliquePage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const reduceMotion = useReducedMotion()

  const { data, isLoading, isError } = useQuery<CollectePubliqueDef>({
    queryKey: ['collecte-publique', slug],
    queryFn: async () => (await api.get(`/public/collectes/${slug}`)).data.data,
    enabled: !!slug,
    retry: false,
  })

  const animation = reduceMotion
    ? undefined
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } }

  if (isLoading) {
    return (
      <PublicShell animation={animation}>
        <div className="space-y-5 p-5 sm:p-7" aria-busy="true" aria-label="Chargement de la collecte">
          <Skeleton.Avatar active size={56} shape="square" />
          <Skeleton active title={{ width: '58%' }} paragraph={{ rows: 3, width: ['100%', '88%', '64%'] }} />
          <Skeleton.Button active block size="large" />
        </div>
      </PublicShell>
    )
  }

  if (isError || !data) {
    return (
      <PublicShell animation={animation}>
        <Result
          status="error"
          title="Collecte introuvable"
          subTitle="Cette collecte n’est plus disponible ou le lien utilisé est incorrect."
          extra={
            <Alert
              type="info"
              showIcon
              message="Besoin d’aide ?"
              description="Vérifiez le lien reçu ou contactez l’organisateur de la collecte."
              className="text-left"
            />
          }
          className="px-4 py-7 sm:px-7"
        />
      </PublicShell>
    )
  }

  return (
    <PublicShell animation={animation}>
      <div className="[&>div]:!min-h-0 [&>div]:!bg-transparent [&>div]:!p-0 [&>div>div]:!max-w-none [&>div>div]:!overflow-visible [&>div>div]:!rounded-none [&>div>div]:!border-0 [&>div>div]:!shadow-none">
        <PublicCollecteStepper collecte={data} slug={slug} />
      </div>
    </PublicShell>
  )
}

type PublicShellProps = {
  children: ReactNode
  animation?: {
    initial: { opacity: number; y: number }
    animate: { opacity: number; y: number }
  }
}

function PublicShell({ children, animation }: PublicShellProps) {
  return (
    <main className="auth-public-background relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-linear-to-b from-[#0f4a0f]/10 to-transparent" />
      <motion.div
        initial={animation?.initial}
        animate={animation?.animate}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative w-full max-w-md"
      >
        <Card
          variant="borderless"
          className="!overflow-hidden !rounded-[24px] shadow-[0_20px_60px_rgba(15,74,15,0.12)]"
          styles={{ body: { padding: 0 } }}
        >
          <header className="bg-linear-to-br from-[#073507] via-[#0f4a0f] to-[#1a6b1a] px-5 py-5 sm:px-7">
            <div className="flex items-center gap-3">
              <BrandMark size={56} variant="compact" alt="Logo CEM" />
              <div>
                <Typography.Text strong className="block !text-base !text-white">
                  SGM-CEM
                </Typography.Text>
                <Typography.Text className="!text-xs !text-white/65">
                  Espace de collecte sécurisé
                </Typography.Text>
              </div>
            </div>
          </header>

          {children}

          <footer className="border-t border-slate-100 px-5 py-4 text-center">
            <Typography.Text type="secondary" className="!text-[11px]">
              Culte d&apos;Enfants de Melen · EEC Yaoundé
            </Typography.Text>
          </footer>
        </Card>
      </motion.div>
    </main>
  )
}
