// Matricules CEM-AAAA-NNNNNN (EF-M02-06) : numéro tiré de la séquence matricule_seq,
// unique même en cas de créations simultanées ou de comptes supprimés.
import type { Prisma, PrismaClient } from '@prisma/client'
import { getPrisma } from '../lib/prisma'

type Db = PrismaClient | Prisma.TransactionClient

const format = (n: bigint | number, year = new Date().getFullYear()) => `CEM-${year}-${String(n).padStart(6, '0')}`

/** Prochains matricules libres (un numéro déjà pris, par exemple saisi à la main, est sauté). */
export async function nextMatricules(count: number, db: Db = getPrisma()): Promise<string[]> {
  const result: string[] = []
  while (result.length < count) {
    const rows = await db.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('"matricule_seq"') AS n FROM generate_series(1, ${count - result.length})`
    const candidates = rows.map(r => format(r.n))
    const [users, membres] = await Promise.all([
      db.user.findMany({ where: { memberId: { in: candidates } }, select: { memberId: true } }),
      db.membre.findMany({ where: { memberId: { in: candidates } }, select: { memberId: true } }),
    ])
    const taken = new Set([...users, ...membres].map(r => r.memberId))
    result.push(...candidates.filter(c => !taken.has(c)))
  }
  return result
}

export async function nextMatricule(db: Db = getPrisma()): Promise<string> {
  return (await nextMatricules(1, db))[0]
}
