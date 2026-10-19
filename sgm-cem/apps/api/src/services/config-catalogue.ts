// Catalogue des réglages gérables depuis le panneau développeur
// (DEVELOPER_PANEL_SGM_CEM.md §6). Source unique : le seed (prisma/seed-config.ts)
// crée les lignes qui ont une valeur ; le panneau affiche aussi les autres
// (« non réglé ») et les crée à la première saisie.
import type { ConfigCategory } from '@prisma/client'

export interface SeedConf {
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

export function configCatalogue(API_URL = process.env.API_URL ?? 'http://localhost:3001'): SeedConf[] {
  return [
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
    {
      key: 'CINETPAY_SECRET_KEY', category: 'INTEGRATION_KEYS', label: 'Clé secrète HMAC CinetPay',
      description: 'Clé x-token utilisée pour vérifier la signature HMAC-SHA256 des webhooks CinetPay.', isSecret: true,
    },
    { key: 'MTN_SUBSCRIPTION_KEY', category: 'INTEGRATION_KEYS', label: 'MTN — Subscription Key', isSecret: true },
    { key: 'MTN_API_USER', category: 'INTEGRATION_KEYS', label: 'MTN — API User' },
    { key: 'MTN_API_KEY', category: 'INTEGRATION_KEYS', label: 'MTN — API Key', isSecret: true },
    { key: 'MTN_WEBHOOK_SECRET', category: 'INTEGRATION_KEYS', label: 'MTN — Secret webhook', isSecret: true },
    { key: 'ORANGE_CLIENT_ID', category: 'INTEGRATION_KEYS', label: 'Orange Money — Client ID' },
    { key: 'ORANGE_CLIENT_SECRET', category: 'INTEGRATION_KEYS', label: 'Orange Money — Client Secret', isSecret: true },
    { key: 'ORANGE_MERCHANT_KEY', category: 'INTEGRATION_KEYS', label: 'Orange Money — Merchant Key', isSecret: true },
    { key: 'DIALOG360_API_KEY', category: 'INTEGRATION_KEYS', label: 'WhatsApp 360Dialog — Clé API', isSecret: true },
    {
      key: 'DIALOG360_BASE_URL', category: 'INTEGRATION_KEYS', label: 'WhatsApp 360Dialog — Adresse de l\'API',
      description: 'API Cloud : https://waba-v2.360dialog.io (défaut). Bac à sable 360dialog : son adresse dédiée.',
      defaultValue: 'https://waba-v2.360dialog.io',
    },
    { key: 'TWILIO_ACCOUNT_SID', category: 'INTEGRATION_KEYS', label: 'Twilio — Account SID' },
    { key: 'TWILIO_AUTH_TOKEN', category: 'INTEGRATION_KEYS', label: 'Twilio — Auth Token', isSecret: true },
    { key: 'TWILIO_FROM', category: 'INTEGRATION_KEYS', label: 'Twilio — Numéro d\'envoi' },
    { key: 'S3_BUCKET_NAME', category: 'INTEGRATION_KEYS', label: 'S3 — Bucket public (reçus, avatars)' },
    {
      key: 'S3_PRIVATE_BUCKET_NAME', category: 'INTEGRATION_KEYS', label: 'S3 — Bucket privé (GED, preuves)',
      description: 'Bucket SANS accès public. Vide : les fichiers privés restent sur le disque du serveur (volume uploads).',
    },
    { key: 'S3_ACCESS_KEY_ID', category: 'INTEGRATION_KEYS', label: 'S3 — Access Key ID', isSecret: true },
    { key: 'S3_SECRET_ACCESS_KEY', category: 'INTEGRATION_KEYS', label: 'S3 — Secret Access Key', isSecret: true },
    { key: 'S3_REGION', category: 'INTEGRATION_KEYS', label: 'S3 — Région' },
    { key: 'S3_ENDPOINT', category: 'INTEGRATION_KEYS', label: 'S3 — Endpoint (R2/MinIO)' },
    { key: 'S3_PUBLIC_URL', category: 'INTEGRATION_KEYS', label: 'S3 — URL publique des objets', description: 'Base de lecture publique sans slash final. Pour Supabase : https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>.' },
    { key: 'GOOGLE_CLIENT_ID', category: 'INTEGRATION_KEYS', label: 'Google OAuth — Client ID' },
    { key: 'SMTP_HOST', category: 'INTEGRATION_KEYS', label: 'SMTP — Hôte' },
    { key: 'SMTP_PORT', category: 'INTEGRATION_KEYS', label: 'SMTP — Port' },
    { key: 'SMTP_SECURE', category: 'INTEGRATION_KEYS', label: 'SMTP — TLS implicite (true/false)' },
    { key: 'SMTP_REQUIRE_TLS', category: 'INTEGRATION_KEYS', label: 'SMTP — STARTTLS exigé (true/false)', description: 'true (défaut) : sans TLS implicite, la connexion doit passer en STARTTLS ; false seulement pour un relais local de confiance.', defaultValue: 'true' },
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
      description: 'true = les écritures sont refusées (503) sauf pour le développeur ; lecture, connexion et webhooks des prestataires continuent. Un bandeau prévient les utilisateurs.', defaultValue: 'false',
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
    {
      key: 'PDF_CONCURRENCY', category: 'SYSTEM_BEHAVIOR', label: 'Rendus PDF simultanés',
      description: 'Nombre maximal de PDF (reçus, bordereaux, rapports) rendus en même temps par le Chromium local. Sans effet si Gotenberg est utilisé.', defaultValue: '2',
    },
    {
      key: 'ANONYMISATION_DELAI_MOIS', category: 'SYSTEM_BEHAVIOR', label: 'Délai avant anonymisation (mois)',
      description: "Durée de conservation de l'identité d'un ancien compte après sa dernière activité ; l'anonymisation n'est possible qu'au-delà (0 : immédiate). Proposition : 36 mois, à confirmer par l'avis juridique (loi 2024/017).", defaultValue: '36',
    },
    {
      key: 'RETENTION_NOTIFICATIONS_MOIS', category: 'SYSTEM_BEHAVIOR', label: 'Conservation des notifications (mois)',
      description: 'Au-delà, les notifications sont supprimées (page de confidentialité : 1 an).', defaultValue: '12',
    },
    {
      key: 'RETENTION_AUDIT_IP_MOIS', category: 'SYSTEM_BEHAVIOR', label: 'Conservation des adresses IP du journal (mois)',
      description: "Au-delà, l'adresse IP et le navigateur sont effacés du journal d'audit ; l'action reste (page de confidentialité : 1 an).", defaultValue: '12',
    },
    {
      key: 'RETENTION_DONATEURS_MOIS', category: 'SYSTEM_BEHAVIOR', label: 'Identité des donateurs non-membres (mois)',
      description: "Sans nouveau don pendant ce délai, l'identité du donateur est anonymisée ; les dons sont conservés (page de confidentialité : 3 ans).", defaultValue: '36',
    },
    {
      key: 'SUPPORT_CONTACT_LABEL', category: 'SYSTEM_BEHAVIOR', label: 'Contact affiché — nom',
      description: "Affiché sur « Mot de passe oublié » (ex. Secrétariat du Culte d'Enfants de Melen). Jamais les coordonnées personnelles d'un administrateur.",
      defaultValue: "Secrétariat du Culte d'Enfants de Melen",
    },
    { key: 'SUPPORT_CONTACT_EMAIL', category: 'SYSTEM_BEHAVIOR', label: 'Contact affiché — e-mail', description: 'Adresse générique de la communauté (facultative).' },
    { key: 'SUPPORT_CONTACT_PHONE', category: 'SYSTEM_BEHAVIOR', label: 'Contact affiché — téléphone', description: 'Numéro générique de la communauté (facultatif).' },
    { key: 'MOBILE_MONEY_ENABLED', category: 'SYSTEM_BEHAVIOR', label: 'Mobile Money activé', defaultValue: 'true' },
    { key: 'CARD_ENABLED', category: 'SYSTEM_BEHAVIOR', label: 'Carte bancaire activée', defaultValue: 'true' },
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
      key: 'WHATSAPP_TEMPLATE_LANG', category: 'NOTIFICATIONS', label: 'WhatsApp — langue des modèles',
      description: 'Code de langue des modèles approuvés par Meta (ex. fr, fr_FR).', defaultValue: 'fr',
    },
    {
      key: 'WHATSAPP_TEMPLATE_OTP', category: 'NOTIFICATIONS', label: 'WhatsApp — modèle « code de connexion »',
      description: 'Nom du modèle approuvé par Meta (catégorie AUTHENTICATION, paramètre {{1}} = code, bouton « copier le code »). Vide = message libre, refusé par WhatsApp hors fenêtre de 24 h.',
    },
    {
      key: 'WHATSAPP_TEMPLATE_PAIEMENT_CONFIRME', category: 'NOTIFICATIONS', label: 'WhatsApp — modèle « paiement confirmé »',
      description: 'Nom du modèle approuvé par Meta ({{1}} membre, {{2}} montant, {{3}} rubrique). Vide = message libre, refusé par WhatsApp hors fenêtre de 24 h.',
    },
    {
      key: 'WHATSAPP_TEMPLATE_PAIEMENT_ECHOUE', category: 'NOTIFICATIONS', label: 'WhatsApp — modèle « paiement échoué »',
      description: 'Nom du modèle approuvé par Meta ({{1}} membre, {{2}} montant, {{3}} rubrique). Vide = message libre, refusé par WhatsApp hors fenêtre de 24 h.',
    },
    {
      key: 'WHATSAPP_TEMPLATE_PAIEMENT_INITIE', category: 'NOTIFICATIONS', label: 'WhatsApp — modèle « paiement Mobile Money à valider »',
      description: 'Nom du modèle approuvé par Meta ({{1}} opérateur, {{2}} montant). Vide = message libre, refusé par WhatsApp hors fenêtre de 24 h.',
    },
    {
      key: 'WHATSAPP_TEMPLATE_A_CONFIRMER', category: 'NOTIFICATIONS', label: 'WhatsApp — modèle « paiement à confirmer (collecteur) »',
      description: 'Nom du modèle approuvé par Meta ({{1}} membre, {{2}} montant, {{3}} rubrique). Vide = message libre, refusé par WhatsApp hors fenêtre de 24 h.',
    },
    {
      key: 'WHATSAPP_TEMPLATE_RELEVE', category: 'NOTIFICATIONS', label: 'WhatsApp — modèle « relevé mensuel »',
      description: 'Nom du modèle approuvé par Meta ({{1}} membre, {{2}} mois, {{3}} confirmé, {{4}} en attente). Vide = message libre, refusé par WhatsApp hors fenêtre de 24 h.',
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

    // Section G (interrupteurs FEATURE_*) retirée au lot 4.5 : aucun n'avait d'effet
  ]
}

/** Entrée du catalogue, ou undefined pour une clé inconnue. */
export function catalogueEntry(key: string): SeedConf | undefined {
  return configCatalogue().find(c => c.key === key)
}
