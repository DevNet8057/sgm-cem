import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const email = 'admin@gmail.com'
  const password = 'admin8057@'
  const passwordHash = await bcrypt.hash(password, 12)

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      isActive: true,
      mustChangePassword: false,
    },
    create: {
      firstName: 'Admin',
      lastName: 'Gmail',
      fullName: 'Admin Gmail',
      email,
      passwordHash,
      role: 'ADMIN',
      memberId: 'CEM-2026-ADMIN2',
      isActive: true,
      mustChangePassword: false,
    },
    select: {
      email: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
    },
  })

  console.log(JSON.stringify({ ...user, password }, null, 2))
}

main()
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
