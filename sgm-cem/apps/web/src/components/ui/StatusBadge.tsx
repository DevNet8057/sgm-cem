import { Tag } from 'antd'
import {
  Archive,
  Check,
  Circle,
  Clock3,
  Code2,
  Flame,
  Landmark,
  LockKeyhole,
  LockKeyholeOpen,
  MapPin,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
  UserRoundCheck,
  UserRoundCog,
  UsersRound,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type S =
  | 'EN_OBSERVATION' | 'EN_SUIVI' | 'FIN_DE_SUIVI' | 'DIASPORA'
  | 'CONFIRME' | 'EN_ATTENTE_CONFIRMATION' | 'LITIGE' | 'ANNULE'
  | 'OUVERTE' | 'FERMEE' | 'ARCHIVEE' | 'URGENT' | 'PRIORITAIRE'
  | 'BROUILLON' | 'EN_ATTENTE' | 'APPROUVE' | 'REJETE' | 'ARCHIVE'
  | 'DEVELOPER' | 'ADMIN' | 'TRESORIER' | 'RESPONSABLE' | 'ADJOINT_RESPONSABLE' | 'COLLECTEUR' | 'MEMBRE'

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'violet' | 'developer'

interface StatusStyle {
  tone: Tone
  icon: LucideIcon
}

const TONE_CLASS: Record<Tone, string> = {
  success: '!border-[rgba(74,222,128,.2)] !bg-[rgba(34,197,94,.12)] !text-[#4ADE80]',
  warning: '!border-[rgba(250,204,21,.2)] !bg-[rgba(250,204,21,.12)] !text-[#FACC15]',
  danger: '!border-[rgba(248,113,113,.2)] !bg-[rgba(239,68,68,.12)] !text-[#F87171]',
  neutral: '!border-[rgba(148,163,184,.16)] !bg-[rgba(148,163,184,.09)] !text-[#94A3B8]',
  info: '!border-[rgba(96,165,250,.18)] !bg-[rgba(59,130,246,.11)] !text-[#60A5FA]',
  violet: '!border-[rgba(167,139,250,.18)] !bg-[rgba(139,92,246,.11)] !text-[#A78BFA]',
  developer: '!border-[rgba(250,204,21,.22)] !bg-[rgba(7,18,13,.72)] !text-[#FACC15]',
}

const STYLE: Record<S, StatusStyle> = {
  // Statuts de contribution
  CONFIRME: { tone: 'success', icon: Check },
  EN_ATTENTE_CONFIRMATION: { tone: 'warning', icon: Clock3 },
  LITIGE: { tone: 'danger', icon: TriangleAlert },
  ANNULE: { tone: 'danger', icon: X },
  // Statuts de rubrique
  OUVERTE: { tone: 'success', icon: LockKeyholeOpen },
  FERMEE: { tone: 'neutral', icon: LockKeyhole },
  ARCHIVEE: { tone: 'neutral', icon: Archive },
  ARCHIVE: { tone: 'neutral', icon: Archive },
  // Priorités
  URGENT: { tone: 'danger', icon: Flame },
  PRIORITAIRE: { tone: 'warning', icon: Sparkles },
  // Statuts de membre
  EN_OBSERVATION: { tone: 'warning', icon: Clock3 },
  EN_SUIVI: { tone: 'info', icon: UserRoundCheck },
  FIN_DE_SUIVI: { tone: 'success', icon: Check },
  DIASPORA: { tone: 'violet', icon: MapPin },
  // Statuts de documents GED
  BROUILLON: { tone: 'neutral', icon: Circle },
  EN_ATTENTE: { tone: 'warning', icon: Clock3 },
  APPROUVE: { tone: 'success', icon: Check },
  REJETE: { tone: 'danger', icon: X },
  // Rôles utilisateurs
  DEVELOPER: { tone: 'developer', icon: Code2 },
  ADMIN: { tone: 'violet', icon: ShieldCheck },
  TRESORIER: { tone: 'success', icon: Landmark },
  RESPONSABLE: { tone: 'info', icon: UserRoundCog },
  ADJOINT_RESPONSABLE: { tone: 'info', icon: UsersRound },
  COLLECTEUR: { tone: 'warning', icon: UserRoundCheck },
  MEMBRE: { tone: 'neutral', icon: UserRound },
}

const LABEL: Record<S, string> = {
  EN_OBSERVATION: 'En observation',
  EN_SUIVI: 'En suivi',
  FIN_DE_SUIVI: 'Fin de suivi',
  DIASPORA: 'Diaspora',
  CONFIRME: 'Confirmé',
  EN_ATTENTE_CONFIRMATION: 'En attente',
  LITIGE: 'Litige',
  ANNULE: 'Annulé',
  OUVERTE: 'Ouverte',
  FERMEE: 'Fermée',
  ARCHIVEE: 'Archivée',
  ARCHIVE: 'Archivé',
  URGENT: 'Urgent',
  PRIORITAIRE: 'Prioritaire',
  BROUILLON: 'Brouillon',
  EN_ATTENTE: 'En attente',
  APPROUVE: 'Approuvé',
  REJETE: 'Rejeté',
  DEVELOPER: 'Développeur',
  ADMIN: 'Administrateur',
  TRESORIER: 'Trésorier',
  RESPONSABLE: 'Responsable',
  ADJOINT_RESPONSABLE: 'Adjoint resp.',
  COLLECTEUR: 'Collecteur',
  MEMBRE: 'Membre',
}

export function StatusBadge({ status, dot = true }: { status: S; dot?: boolean }) {
  const { tone, icon: Icon } = STYLE[status]

  return (
    <Tag
      bordered
      className={cn(
        '!m-0 inline-flex !h-7 items-center gap-1.5 !rounded-full !px-2.5 !py-0',
        '!text-[13px] !font-semibold !leading-none',
        'transition-[background-color,border-color,color,transform] duration-[250ms]',
        status === 'URGENT' && 'animate-[urgence-pulse_2s_ease-in-out_infinite]',
        TONE_CLASS[tone]
      )}
    >
      {dot && <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.25} />}
      <span>{LABEL[status]}</span>
    </Tag>
  )
}
