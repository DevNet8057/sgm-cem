import { PrismaClient } from '@prisma/client'
import { generateTemporaryPassword, hashPassword } from '../src/lib/password'

// Réinitialisation de secours d'un compte (ADMIN perdu, etc.) depuis le serveur :
//   TARGET_EMAIL=admin@exemple.cm pnpm exec ts-node prisma/reset-admin-password.ts
// Un mot de passe temporaire aléatoire est affiché une seule fois ; il doit être
// changé à la connexion suivante et toutes les sessions du compte sont fermées.
const prisma = new PrismaClient()

async function main() {
  const email = process.env.TARGET_EMAIL?.toLowerCase().trim()
  if (!email) throw new Error('TARGET_EMAIL est requis')

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw new Error(`Aucun compte pour ${email}`)

  const password = generateTemporaryPassword()
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), isActive: true, mustChangePassword: true },
    }),
    prisma.userSession.deleteMany({ where: { userId: user.id } }),
    prisma.auditLog.create({
      data: {
        userId: user.id, userName: user.fullName, action: 'UPDATE', entityType: 'User', entityId: user.id,
        details: { action: 'password_reset', source: 'maintenance-script' },
      },
    }),
  ])

  console.log(`Compte ${email} (${user.role}) réinitialisé.`)
  console.log(`Mot de passe temporaire (à changer à la connexion) : ${password}`)
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
