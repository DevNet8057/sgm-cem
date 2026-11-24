#!/usr/bin/env node
'use strict'

const { createRequire } = require('node:module')
const apiRequire = createRequire('/app/apps/api/package.json')
const { PrismaClient } = apiRequire('@prisma/client')
const bcrypt = apiRequire('bcrypt')
const prisma = new PrismaClient()

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD || ''
  if (!email || password.length < 20) {
    throw new Error('ADMIN_EMAIL et un ADMIN_PASSWORD fort sont requis.')
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (!['ADMIN', 'DEVELOPER'].includes(existing.role)) {
      throw new Error('Le compte existant ne possède pas un rôle administrateur.')
    }
    await prisma.systemSettings.upsert({
      where: { id: 'singleton' }, update: {}, create: { id: 'singleton' },
    })
    console.log('Compte initial existant conservé ; aucun mot de passe remplacé.')
    return
  }
  if (await prisma.user.count() !== 0) {
    throw new Error('Base déjà peuplée : création automatique de compte refusée.')
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: {
      memberId: `CEM-${new Date().getFullYear()}-000001`,
      email,
      firstName: 'Administrateur',
      lastName: 'SGM-CEM',
      fullName: 'Administrateur SGM-CEM',
      passwordHash,
      role: 'ADMIN',
      isActive: true,
      mustChangePassword: false,
    } })
    await tx.systemSettings.upsert({
      where: { id: 'singleton' }, update: {}, create: { id: 'singleton' },
    })
    await tx.auditLog.create({ data: {
      userId: user.id,
      userName: user.fullName,
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      details: { source: 'production-bootstrap', demonstrationData: false },
    } })
  })
  console.log('Compte administrateur initial créé ; aucune donnée de démonstration ajoutée.')
}

main()
  .catch(error => {
    console.error(`Échec du bootstrap de production (${error.code || error.name || 'erreur'}).`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
