// ──────────────────────────────────────────────────────────────────────
// SEED CONFIGURATION TECHNIQUE — DEVELOPER_PANEL_SGM_CEM.md §6
//
// Copie les valeurs actuelles du .env vers la table system_configs pour
// que la transition soit transparente (idempotent : n'écrase jamais une
// valeur déjà présente en base).
//
// Exécution : pnpm ts-node prisma/seed-config.ts  (depuis apps/api)
//
// JAMAIS ici : JWT_SECRET, REFRESH_TOKEN_SECRET, CSRF_SECRET, DATABASE_URL
// (secrets d'authentification — restent exclusivement dans .env).
//
// Fait aussi : élévation du compte ADMIN_EMAIL au rôle DEVELOPER
// (option « élever ton compte personnel » du doc §1).
// ──────────────────────────────────────────────────────────────────────
import 'dotenv/config'
import { createPrismaClient } from '../src/lib/prisma'
import { encryptSecret } from '../src/lib/secret-box'
import { configCatalogue } from '../src/services/config-catalogue'

const prisma = createPrismaClient()

const initialConfigs = configCatalogue()

async function seedConfig() {
  let created = 0
  let skippedNoValue = 0
  let alreadyPresent = 0

  for (const conf of initialConfigs) {
    const envValue = process.env[conf.key]
    const value = envValue ?? conf.defaultValue
    if (value === undefined) { skippedNoValue++; continue } // pas de valeur .env ni défaut → pas d'entrée vide

    const existing = await prisma.systemConfig.findUnique({ where: { key: conf.key } })
    if (existing) { alreadyPresent++; continue } // idempotent : ne jamais écraser la base

    await prisma.systemConfig.create({
      data: {
        key: conf.key,
        value: conf.isSecret ? encryptSecret(value, conf.key) : value,
        category: conf.category,
        label: conf.label,
        description: conf.description,
        isSecret: conf.isSecret ?? false,
      },
    })
    created++
  }

  console.log(`[Seed Config] ${created} créés · ${alreadyPresent} déjà en base (non écrasés) · ${skippedNoValue} sans valeur (ignorés)`)
}

async function promoteDeveloper() {
  const email = (process.env.DEVELOPER_EMAIL ?? process.env.ADMIN_EMAIL ?? '').toLowerCase().trim()
  if (!email) {
    console.log('[Seed Config] Pas de DEVELOPER_EMAIL/ADMIN_EMAIL — aucune élévation')
    return
  }
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.log(`[Seed Config] ${email} introuvable — aucune élévation`)
    return
  }
  if (user.role === 'DEVELOPER') {
    console.log(`[Seed Config] ${email} est déjà DEVELOPER`)
    return
  }
  await prisma.user.update({ where: { id: user.id }, data: { role: 'DEVELOPER' } })
  console.log(`[Seed Config] ✅ ${email} élevé au rôle DEVELOPER (était ${user.role})`)
}

async function main() {
  await seedConfig()
  await promoteDeveloper()
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
