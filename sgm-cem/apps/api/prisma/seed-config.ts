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
import { PrismaClient, ConfigCategory } from '@prisma/client'

const prisma = new PrismaClient()

interface SeedConf {
  key: string
  category: ConfigCategory
  label: string
  description?: string
  isSecret?: boolean
  // Valeur par défaut pour les clés NOUVELLES sans équivalent .env
  // (feature flags, maintenance…) — sans ligne en base, la section du
  // panneau serait vide et ingérable. Les clés .env classiques n'en ont
  // pas : « pas de valeur .env → ne pas créer d'entrée vide » (§6).
  defaultValue?: string
}

const API_URL = process.env.API_URL ?? 'http://localhost:3001'

const initialConfigs: SeedConf[] = [
  // ── Section A — Webhooks & Callbacks ─────────────────────────────────
  {
    key: 'YELII_WEBHOOK_URL', category: 'WEBHOOKS', label: 'URL Webhook Yelii',
    description: 'URL complète appelée par Yelii pour notifier un paiement (callbackUrl). Recalculable depuis le panneau.',
    defaultValue: `${API_URL}/webhooks/yelii`,
  },
  {
    key: 'PAYMENT_RETURN_URL', category: 'WEBHOOKS', label: 'URL de retour après paiement',
    description: 'Page vers laquelle le contributeur est redirigé après un paiement (CinetPay return_url).',
    defaultValue: `${process.env.APP_URL ?? 'http://localhost:3000'}/payment/return`,
  },

  // ── Section B — Clés d'intégration (secrets masqués ••••) ────────────
  {
    key: 'YELII_COLLECT_API_KEY', category: 'INTEGRATION_KEYS', label: 'Clé API Yelii (collecte)',
    description: 'Clé X-Collect-Api-Key — sert aussi à vérifier la signature HMAC-SHA512 des webhooks.', isSecret: true,
  },
  { key: 'YELII_BASE_URL', category: 'INTEGRATION_KEYS', label: 'URL de base Yelii' },
  { key: 'CINETPAY_API_KEY', category: 'INTEGRATION_KEYS', label: 'Clé API CinetPay', isSecret: true },
  { key: 'CINETPAY_SITE_ID', category: 'INTEGRATION_KEYS', label: 'Site ID CinetPay' },
  { key: 'MTN_SUBSCRIPTION_KEY', category: 'INTEGRATION_KEYS', label: 'MTN — Subscription Key', isSecret: true },
  { key: 'MTN_API_USER', category: 'INTEGRATION_KEYS', label: 'MTN — API User' },
  { key: 'MTN_API_KEY', category: 'INTEGRATION_KEYS', label: 'MTN — API Key', isSecret: true },
  { key: 'MTN_WEBHOOK_SECRET', category: 'INTEGRATION_KEYS', label: 'MTN — Secret webhook', isSecret: true },
  { key: 'ORANGE_CLIENT_ID', category: 'INTEGRATION_KEYS', label: 'Orange Money — Client ID' },
  { key: 'ORANGE_CLIENT_SECRET', category: 'INTEGRATION_KEYS', label: 'Orange Money — Client Secret', isSecret: true },
  { key: 'ORANGE_MERCHANT_KEY', category: 'INTEGRATION_KEYS', label: 'Orange Money — Merchant Key', isSecret: true },
  { key: 'DIALOG360_API_KEY', category: 'INTEGRATION_KEYS', label: 'WhatsApp 360Dialog — Clé API', isSecret: true },
  { key: 'TWILIO_ACCOUNT_SID', category: 'INTEGRATION_KEYS', label: 'Twilio — Account SID' },
  { key: 'TWILIO_AUTH_TOKEN', category: 'INTEGRATION_KEYS', label: 'Twilio — Auth Token', isSecret: true },
  { key: 'TWILIO_FROM', category: 'INTEGRATION_KEYS', label: 'Twilio — Numéro d\'envoi' },
  { key: 'S3_BUCKET_NAME', category: 'INTEGRATION_KEYS', label: 'S3 — Bucket' },
  { key: 'S3_ACCESS_KEY_ID', category: 'INTEGRATION_KEYS', label: 'S3 — Access Key ID', isSecret: true },
  { key: 'S3_SECRET_ACCESS_KEY', category: 'INTEGRATION_KEYS', label: 'S3 — Secret Access Key', isSecret: true },
  { key: 'S3_REGION', category: 'INTEGRATION_KEYS', label: 'S3 — Région' },
  { key: 'S3_ENDPOINT', category: 'INTEGRATION_KEYS', label: 'S3 — Endpoint (R2/MinIO)' },
  { key: 'GOOGLE_CLIENT_ID', category: 'INTEGRATION_KEYS', label: 'Google OAuth — Client ID' },
  { key: 'SMTP_HOST', category: 'INTEGRATION_KEYS', label: 'SMTP — Hôte' },
  { key: 'SMTP_PORT', category: 'INTEGRATION_KEYS', label: 'SMTP — Port' },
  { key: 'SMTP_SECURE', category: 'INTEGRATION_KEYS', label: 'SMTP — TLS implicite (true/false)' },
  { key: 'SMTP_USER', category: 'INTEGRATION_KEYS', label: 'SMTP — Utilisateur' },
  { key: 'SMTP_PASS', category: 'INTEGRATION_KEYS', label: 'SMTP — Mot de passe', isSecret: true },
  { key: 'SMTP_FROM', category: 'INTEGRATION_KEYS', label: 'SMTP — Adresse d\'envoi' },
  { key: 'CRON_SECRET', category: 'INTEGRATION_KEYS', label: 'Secret du cron manuel (X-Cron-Secret)', isSecret: true },

  // ── Section C — Paramètres financiers dynamiques ─────────────────────
  // (les ratios étudiant/couple et le taux annuel restent dans la page
  //  « Paramètres » ADMIN existante — harmonisation §5C, pas de doublon)
  {
    key: 'YELII_COMMISSION_RATE', category: 'FINANCIAL', label: 'Taux de commission Yelii',
    description: 'Taux prélevé par Yelii (0.025 = 2,5 %). Le contributeur paie montant/(1-taux). Modifier UNIQUEMENT si Yelii change son taux.',
    defaultValue: '0.025',
  },

  // ── Section D — Infrastructure & réseau ──────────────────────────────
  {
    key: 'APP_URL', category: 'INFRASTRUCTURE', label: 'URL de l\'application',
    description: 'Origines CORS autorisées — plusieurs valeurs séparées par des virgules.',
  },
  { key: 'API_URL', category: 'INFRASTRUCTURE', label: 'URL de l\'API' },
  {
    key: 'MAINTENANCE_MODE', category: 'INFRASTRUCTURE', label: 'Mode maintenance',
    description: 'true = l\'API répond 503 à toutes les requêtes métier.', defaultValue: 'false',
  },
  {
    key: 'MAINTENANCE_MESSAGE', category: 'INFRASTRUCTURE', label: 'Message de maintenance',
    defaultValue: 'Maintenance en cours — merci de réessayer dans quelques minutes.',
  },

  // ── Section E — Comportement système ─────────────────────────────────
  // (délais rappel/rétention : page « Paramètres » ADMIN existante — harmonisation)
  {
    key: 'RECONCILIATION_INTERVAL_MINUTES', category: 'SYSTEM_BEHAVIOR', label: 'Fréquence réconciliation Yelii (min)',
    description: 'Intervalle du job qui vérifie les paiements bloqués en PROCESSING.', defaultValue: '10',
  },
  { key: 'MOBILE_MONEY_ENABLED', category: 'SYSTEM_BEHAVIOR', label: 'Mobile Money activé', defaultValue: 'true' },
  { key: 'CASH_ENABLED', category: 'SYSTEM_BEHAVIOR', label: 'Espèces activées', defaultValue: 'true' },
  { key: 'LOG_LEVEL', category: 'SYSTEM_BEHAVIOR', label: 'Niveau de log', description: 'debug / info / warning / error', defaultValue: 'info' },

  // ── Section F — Notifications ────────────────────────────────────────
  { key: 'WHATSAPP_ENABLED', category: 'NOTIFICATIONS', label: 'WhatsApp activé', defaultValue: 'true' },
  { key: 'SMS_ENABLED', category: 'NOTIFICATIONS', label: 'SMS (Twilio) activé', defaultValue: 'true' },
  { key: 'EMAIL_ENABLED', category: 'NOTIFICATIONS', label: 'Email (SMTP) activé', defaultValue: 'true' },
  { key: 'PUSH_ENABLED', category: 'NOTIFICATIONS', label: 'Notifications push navigateur activées', defaultValue: 'true' },
  {
    key: 'AUTO_SEND_RECEIPT_WHATSAPP', category: 'NOTIFICATIONS', label: 'Envoi auto du reçu par WhatsApp',
    description: 'false = le reçu est présenté dans l\'app (Partager/Imprimer) au lieu d\'être envoyé en document WhatsApp. Le message texte de confirmation reste envoyé.',
    defaultValue: 'false',
  },
  {
    key: 'VAPID_PUBLIC_KEY', category: 'NOTIFICATIONS', label: 'Web Push — clé publique VAPID',
    description: 'Clé publique transmise aux navigateurs pour l\'abonnement push.',
  },
  {
    key: 'VAPID_PRIVATE_KEY', category: 'NOTIFICATIONS', label: 'Web Push — clé privée VAPID',
    description: 'Ne JAMAIS divulguer. Regénérer les deux clés invalide tous les abonnements.', isSecret: true,
  },
  { key: 'VAPID_SUBJECT', category: 'NOTIFICATIONS', label: 'Web Push — contact (mailto:)' },

  // ── Section G — Feature flags ────────────────────────────────────────
  { key: 'FEATURE_OFFLINE_PWA', category: 'FEATURE_FLAGS', label: 'Mode hors ligne PWA', defaultValue: 'true' },
  { key: 'FEATURE_QUERY_BUILDER', category: 'FEATURE_FLAGS', label: 'Query builder avancé', defaultValue: 'true' },
  { key: 'FEATURE_PERCENT_DISTRIBUTION', category: 'FEATURE_FLAGS', label: 'Répartition par pourcentage (Partie E)', defaultValue: 'false' },
]

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
        value,
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
