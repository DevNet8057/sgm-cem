// Contributeurs externes (collectes publiques) — EF-M08-06.
// Un même téléphone peut servir à plusieurs personnes d'une famille : le premier
// nom enregistré n'est jamais écrasé, un nom différent devient un alias, et le
// nom saisi est conservé sur le don lui-même (reçu, exports).
import type { Prisma, PrismaClient } from '@prisma/client'

const MAX_ALIASES = 10

/** Nom nettoyé : espaces réduits, longueur bornée. */
export function cleanDonorName(nom: string): string {
  return nom.replace(/\s+/g, ' ').trim().slice(0, 120)
}

// Comparaison sans casse ni accents : « Élise Mbarga » = « elise  mbarga »
const comparable = (nom: string) => cleanDonorName(nom).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Alias à ajouter, ou null si le nom est déjà connu (nom principal ou alias). */
export function nextAliases(current: { nom: string; aliases: string[] }, saisi: string): string[] | null {
  const key = comparable(saisi)
  if (!key || comparable(current.nom) === key || current.aliases.some(a => comparable(a) === key)) return null
  if (current.aliases.length >= MAX_ALIASES) return null
  return [...current.aliases, cleanDonorName(saisi)]
}

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Retrouve (par téléphone) ou crée le contributeur, sans écraser son nom ni son e-mail.
 * Le consentement est celui de la saisie en cours.
 */
export async function resolveExternalContributor(db: Db, input: {
  phone: string; nom: string; email?: string | null; consentVersion: string
}) {
  const nom = cleanDonorName(input.nom)
  const consent = { consentAt: new Date(), consentVersion: input.consentVersion }
  const existing = await db.contributeurExterne.findFirst({ where: { phone: input.phone } })
  if (!existing) {
    return db.contributeurExterne.create({ data: { nom, phone: input.phone, email: input.email ?? null, ...consent } })
  }
  const aliases = nextAliases(existing, nom)
  return db.contributeurExterne.update({
    where: { id: existing.id },
    data: {
      ...consent,
      ...(aliases && { aliases }),
      // L'e-mail connu est conservé ; il n'est complété que s'il manquait
      ...(!existing.email && input.email ? { email: input.email } : {}),
    },
  })
}

/** Nom du payeur d'une contribution : membre, sinon nom saisi pour ce don, sinon nom du contributeur. */
export function payerName(c: {
  membre?: { user: { fullName: string } } | null
  nomDonateur?: string | null
  contributeurExterne?: { nom: string } | null
}): string | undefined {
  return c.membre?.user.fullName ?? c.nomDonateur ?? c.contributeurExterne?.nom
}
