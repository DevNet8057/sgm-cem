import { Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler'

const MEMBER_ID_LOCK_NAMESPACE = 734_021

/** Réserve une plage d’identifiants membres dans la transaction en cours. */
export async function reserveMemberIds(
  tx: Prisma.TransactionClient,
  count: number,
): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) {
    throw new AppError('VALIDATION_ERROR', 'Le nombre d’identifiants à réserver est invalide', 400)
  }

  const year = new Date().getFullYear()

  // Le verrou transactionnel sérialise les créations faites par les routes
  // membres et utilisateurs, sans ajouter de séquence ou de colonne au schéma.
  await tx.$queryRaw<Array<{ locked: number }>>`
    SELECT 1 AS locked
    FROM pg_advisory_xact_lock(${MEMBER_ID_LOCK_NAMESPACE}::integer, ${year}::integer)
  `

  const pattern = `^CEM-${year}-[0-9]{6}$`
  const [result] = await tx.$queryRaw<Array<{ maxSuffix: number | null }>>`
    SELECT MAX(SUBSTRING("memberId" FROM 10)::INTEGER) AS "maxSuffix"
    FROM "users"
    WHERE "memberId" ~ ${pattern}
  `

  const firstSuffix = (result?.maxSuffix ?? 0) + 1
  if (firstSuffix + count - 1 > 999_999) {
    throw new AppError('ID_CAPACITY_EXCEEDED', 'La capacité des identifiants membres pour cette année est atteinte', 409)
  }

  return Array.from({ length: count }, (_, index) =>
    `CEM-${year}-${String(firstSuffix + index).padStart(6, '0')}`,
  )
}
