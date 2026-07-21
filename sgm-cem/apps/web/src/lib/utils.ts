import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export const formatAmount = (amount: number | null | undefined): string => {
  if (amount == null) return '—'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'XAF', maximumFractionDigits: 0
  }).format(amount)
}

export const formatDate = (date: string | Date): string =>
  new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })

export const formatDateTime = (date: string | Date): string =>
  new Date(date).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const timeAgo = (date: string | Date): string => {
  const diff = Date.now() - new Date(date).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "À l'instant"
  if (min < 60) return `Il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `Il y a ${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `Il y a ${d}j`
  return formatDate(date)
}

export const progressColor = (ratio: number): string =>
  ratio >= 0.8 ? '#1A6B1A' : ratio >= 0.5 ? '#D97706' : '#DC2626'

export const progressGradient = (ratio: number): string =>
  ratio >= 0.8 ? 'linear-gradient(90deg,#1A6B1A,#2D8C2D)' :
  ratio >= 0.5 ? 'linear-gradient(90deg,#D97706,#F59E0B)' :
                 'linear-gradient(90deg,#DC2626,#EF4444)'

export const getInitials = (fullName: string): string =>
  fullName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()

export const AVATAR_PALETTE: Array<{ bg: string; text: string }> = [
  { bg: '#E8F5E8', text: '#0F4A0F' },
  { bg: '#D4EDD4', text: '#1A6B1A' },
  { bg: '#FEF3C7', text: '#92400E' },
  { bg: '#F3F4F6', text: '#374151' },
  { bg: '#FCE7D6', text: '#9A3412' },
  { bg: '#E2E8F0', text: '#334155' },
]

export const avatarColorFromName = (name: string): { bg: string; text: string } => {
  const trimmed = name.trim()
  if (!trimmed) return AVATAR_PALETTE[0]
  let hash = 0
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

export const ROLE_LEVELS: Record<string, number> = {
  DEVELOPER: 6, ADMIN: 5, TRESORIER: 4, RESPONSABLE: 3,
  ADJOINT_RESPONSABLE: 3, COLLECTEUR: 2, MEMBRE: 1,
}

export const hasMinLevel = (userRole: string, minLevel: number): boolean =>
  (ROLE_LEVELS[userRole] ?? 0) >= minLevel

export const canAccess = (userRole: string, requiredRoles: string[]): boolean =>
  requiredRoles.includes(userRole)

export const ROLE_LABELS: Record<string, string> = {
  DEVELOPER: 'Développeur',
  ADMIN: 'Administrateur',
  TRESORIER: 'Trésorier',
  RESPONSABLE: 'Responsable',
  ADJOINT_RESPONSABLE: 'Adjoint Resp.',
  COLLECTEUR: 'Collecteur',
  MEMBRE: 'Membre',
}

export const MODE_PAIEMENT_LABELS: Record<string, string> = {
  ESPECES: 'Espèces',
  MTN_MOMO: 'MTN MoMo',
  ORANGE_MONEY: 'Orange Money',
  YELII: 'Yelii',
  CARTE_VISA: 'Carte Visa',
  VIREMENT: 'Virement',
}

export const LOCALISATION_FONDS_LABELS: Record<string, string> = {
  CHEZ_COLLECTEUR: 'Chez collecteur',
  EN_TRANSIT: 'En transit',
  CHEZ_RESPONSABLE: 'Chez Responsable',
  REMIS_TRESORIER: 'Remis trésorier',
  EN_CAISSE: 'En caisse',
  EN_BANQUE: 'En banque',
}

export const TRANSFER_TYPE_LABELS: Record<string, string> = {
  ESPECES_EN_MAIN: 'En main propre',
  DEPOT_MTN: 'Dépôt MTN MoMo',
  DEPOT_ORANGE: 'Dépôt Orange Money',
  AUTRE: 'Autre mode',
}

export const TRANSFER_TYPE_EMOJI: Record<string, string> = {
  ESPECES_EN_MAIN: '🤝',
  DEPOT_MTN: '🟡',
  DEPOT_ORANGE: '🟠',
  AUTRE: '📦',
}

export const FUND_TRANSFER_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: 'En attente',
  CONFIRMED: 'Confirmé',
  REFUSED: 'Refusé',
  CANCELLED: 'Annulé',
}
