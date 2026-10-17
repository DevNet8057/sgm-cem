import { verifyPassword } from '../src/lib/password'
import { createPrismaClient } from '../src/lib/prisma'

// Repère les comptes qui utilisent encore un ancien mot de passe commun
// (décision du Bureau : rien n'est forcé, l'administrateur prévient les titulaires).
// Les mots de passe à tester sont fournis par l'opérateur, jamais écrits ici :
//   CANDIDATE_PASSWORDS='motdepasse1|motdepasse2' pnpm exec ts-node prisma/audit-default-passwords.ts
// Ajouter FORCE_CHANGE=1 pour imposer le changement aux comptes trouvés (sur décision explicite).
const prisma = createPrismaClient()

async function main() {
  const candidates = (process.env.CANDIDATE_PASSWORDS ?? '').split('|').filter(Boolean)
  if (candidates.length === 0) throw new Error('CANDIDATE_PASSWORDS est requis (séparateur |)')

  const users = await prisma.user.findMany({
    where: { isActive: true, NOT: { passwordHash: 'disabled' } },
    select: { id: true, email: true, role: true, passwordHash: true, mustChangePassword: true },
  })

  const exposed: typeof users = []
  for (const [index, user] of users.entries()) {
    for (const candidate of candidates) {
      if (await verifyPassword(candidate, user.passwordHash)) {
        exposed.push(user)
        break
      }
    }
    if ((index + 1) % 25 === 0) console.log(`… ${index + 1}/${users.length} comptes vérifiés`)
  }

  console.log(`\n${exposed.length} compte(s) actif(s) sur ${users.length} utilisent un mot de passe commun :`)
  for (const user of exposed) console.log(`  - ${user.role.padEnd(20)} ${user.email}${user.mustChangePassword ? ' (changement déjà demandé)' : ''}`)

  if (process.env.FORCE_CHANGE === '1' && exposed.length > 0) {
    await prisma.user.updateMany({ where: { id: { in: exposed.map(u => u.id) } }, data: { mustChangePassword: true } })
    await prisma.auditLog.createMany({
      data: exposed.map(user => ({
        userId: user.id, userName: 'maintenance-script', action: 'UPDATE' as const, entityType: 'User', entityId: user.id,
        details: { action: 'force_password_change', source: 'audit-default-passwords' },
      })),
    })
    console.log(`\nChangement de mot de passe imposé à ${exposed.length} compte(s).`)
  }
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
