import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const email = process.env.TARGET_DEVELOPER_EMAIL?.toLowerCase().trim()
  const password = process.env.TARGET_DEVELOPER_PASSWORD

  if (!email || !password) {
    throw new Error('TARGET_DEVELOPER_EMAIL and TARGET_DEVELOPER_PASSWORD are required')
  }

  const developers = await prisma.user.findMany({
    where: { role: 'DEVELOPER' },
    select: { id: true, email: true, fullName: true, isActive: true },
  })

  if (developers.length !== 1) {
    throw new Error(`Expected exactly one DEVELOPER account, found ${developers.length}`)
  }

  const developer = developers[0]
  const passwordHash = await bcrypt.hash(password, 12)

  const updated = await prisma.$transaction(async tx => {
    const user = await tx.user.update({
      where: { id: developer.id },
      data: {
        email,
        passwordHash,
        isActive: true,
        mustChangePassword: false,
      },
      select: {
        id: true,
        memberId: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
      },
    })

    await tx.userSession.deleteMany({ where: { userId: developer.id } })
    await tx.auditLog.create({
      data: {
        userId: developer.id,
        userName: developer.fullName,
        action: 'UPDATE',
        entityType: 'UserCredentials',
        entityId: developer.id,
        details: {
          emailChanged: developer.email !== email,
          passwordChanged: true,
          sessionsInvalidated: true,
          source: 'maintenance-script',
        },
      },
    })

    return user
  })

  const stored = await prisma.user.findUniqueOrThrow({
    where: { id: developer.id },
    select: { passwordHash: true },
  })
  const passwordVerified = await bcrypt.compare(password, stored.passwordHash)
  const activeSessionCount = await prisma.userSession.count({
    where: { userId: developer.id },
  })

  console.log(JSON.stringify({ user: updated, passwordVerified, activeSessionCount }))
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
