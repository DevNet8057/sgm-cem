// Clôture mensuelle (lot 4.2 — EF-M07-09). Chiffres d'un mois, à l'heure de
// Yaoundé (UTC+1, sans heure d'été) : encaissements confirmés du mois,
// remboursements exécutés dans le mois, position des fonds au dernier instant.
import { getPrisma } from '../lib/prisma'
import { positionAt, type FundsPosition } from './fund-ledger.service'
import { refundsTotal } from './refund.service'

const prisma = getPrisma()
const DOUALA_OFFSET_MS = 60 * 60 * 1000

export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** Bornes UTC d'un mois civil de Yaoundé. */
export function monthBounds(annee: number, mois: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(annee, mois - 1, 1) - DOUALA_OFFSET_MS)
  const next = new Date(Date.UTC(annee, mois, 1) - DOUALA_OFFSET_MS)
  return { start, end: new Date(next.getTime() - 1) }
}

export interface ClosureFigures {
  annee: number
  mois: number
  libelle: string
  position: FundsPosition
  totalEncaisse: number
  totalRembourse: number
  nbContributions: number
  // Attendus d'après le grand livre au dernier instant du mois
  attenduCaisse: number
  attenduBanque: number
  attenduPortefeuille: number
}

export async function closureFigures(annee: number, mois: number): Promise<ClosureFigures> {
  const { start, end } = monthBounds(annee, mois)
  const [position, encaisse, rembourse] = await Promise.all([
    positionAt(prisma, end),
    prisma.contribution.aggregate({ where: { statut: 'CONFIRME', createdAt: { gte: start, lte: end } }, _sum: { montant: true }, _count: true }),
    refundsTotal({ gte: start, lte: end }),
  ])
  const at = (...locations: string[]) => position.byLocation.filter(r => locations.includes(r.location)).reduce((s, r) => s + r.amount, 0)
  return {
    annee, mois, libelle: `${MOIS[mois - 1]} ${annee}`,
    position,
    totalEncaisse: encaisse._sum.montant ?? 0,
    totalRembourse: rembourse,
    nbContributions: encaisse._count,
    // Espèces et fonds remis au trésorier : ce qu'il doit pouvoir compter
    attenduCaisse: at('EN_CAISSE', 'REMIS_TRESORIER'),
    attenduBanque: at('EN_BANQUE'),
    attenduPortefeuille: at('PORTEFEUILLE_ELECTRONIQUE'),
  }
}
