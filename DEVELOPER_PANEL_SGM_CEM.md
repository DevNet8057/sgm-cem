# PANNEAU DÉVELOPPEUR — CONFIGURATION TECHNIQUE DYNAMIQUE
## SGM-CEM · Rôle DEVELOPER + Système de Configuration en Base de Données
## Document de Référence Complet

---

## À LIRE EN PREMIER

Ce document décrit une nouvelle fonctionnalité : un rôle **DEVELOPER**, au-dessus d'ADMIN dans la hiérarchie des permissions, avec un panneau de configuration technique qui permet de gérer l'infrastructure et les intégrations **sans jamais toucher au code ni redémarrer le serveur**.

**Principe fondamental de cette fonctionnalité : la base de données devient la source de vérité à l'exécution.** Le fichier `.env` ne sert plus que de valeur de secours au tout premier démarrage (quand la base est encore vide). Une fois le système initialisé, chaque lecture d'une configuration technique (URL de webhook, clé API, etc.) se fait **depuis la base de données**, jamais depuis `process.env` directement dans le code métier.

Lire `CLAUDE.md` et `PROGRESS_SGM_CEM.md` avant de commencer. Ajouter une nouvelle section dans `PROGRESS_SGM_CEM.md` :

```markdown
## J. PANNEAU DÉVELOPPEUR + CONFIGURATION DYNAMIQUE
- [ ] J1. Nouveau rôle DEVELOPER dans l'enum Role + RBAC
- [ ] J2. Modèle Prisma SystemConfig (clé-valeur en base) + historique des changements
- [ ] J3. Service de configuration centralisé (lecture DB avec fallback .env)
- [ ] J4. Migration : toutes les lectures process.env critiques → service de config
- [ ] J5. Interface panneau développeur — section Webhooks & Callbacks
- [ ] J6. Interface panneau développeur — section Clés d'intégration
- [ ] J7. Interface panneau développeur — section Paramètres financiers dynamiques
- [ ] J8. Interface panneau développeur — section Infrastructure & réseau
- [ ] J9. Interface panneau développeur — section Comportement système
- [ ] J10. Interface panneau développeur — section Notifications
- [ ] J11. Interface panneau développeur — section Feature flags
- [ ] J12. Bouton "Recalculer l'URL de webhook" avec historique
- [ ] J13. Audit log spécifique aux changements de configuration technique
```

---

## 1. LE NOUVEAU RÔLE — DEVELOPER

### Où il se place dans la hiérarchie

```
DEVELOPER              — niveau 6   ← NOUVEAU, au-dessus de tout
ADMIN                  — niveau 5
TRESORIER              — niveau 4
RESPONSABLE            — niveau 3
ADJOINT_RESPONSABLE    — niveau 3
COLLECTEUR             — niveau 2
MEMBRE                 — niveau 1
```

### Ce que DEVELOPER peut faire que ADMIN ne peut pas

ADMIN gère l'organisation (utilisateurs, rôles, paramètres financiers métier déjà existants dans "Paramètres Système"). **DEVELOPER gère l'infrastructure technique** — une couche complètement différente, invisible et sans intérêt pour un administrateur fonctionnel de l'église.

Concrètement : ton compte "DevNet Admin" actuel reste un compte ADMIN pour la gestion quotidienne. Tu crées un compte séparé (ou tu élèves ton compte personnel) avec le rôle DEVELOPER, réservé à toi en tant que développeur/mainteneur technique du projet.

### Modification du schéma Prisma

```prisma
enum Role {
  DEVELOPER              // NOUVEAU — niveau 6, accès total + config technique
  ADMIN
  TRESORIER
  RESPONSABLE
  ADJOINT_RESPONSABLE
  COLLECTEUR
  MEMBRE
}
```

### Modification du RBAC backend

```typescript
// apps/api/src/middleware/rbac.ts

const ROLE_LEVELS: Record<string, number> = {
  DEVELOPER: 6,           // NOUVEAU
  ADMIN: 5,
  TRESORIER: 4,
  RESPONSABLE: 3,
  ADJOINT_RESPONSABLE: 3,
  COLLECTEUR: 2,
  MEMBRE: 1,
}

// Middleware dédié pour les routes de config technique — DEVELOPER uniquement
export const requireDeveloper = requireRole('DEVELOPER')
```

**Règle d'accès stricte** : toutes les routes du panneau développeur (section 5 et suivantes) doivent utiliser `requireDeveloper`, pas `requireLevel(5)` — même ADMIN ne doit pas pouvoir y accéder, uniquement DEVELOPER exactement.

---

## 2. LE MODÈLE DE DONNÉES — CONFIGURATION EN BASE

### Pourquoi une table clé-valeur plutôt que des colonnes fixes

Une table clé-valeur (`SystemConfig`) permet d'ajouter de nouveaux paramètres techniques dans le futur sans migration Prisma à chaque fois — juste une nouvelle ligne en base. C'est le pattern standard pour ce type de configuration dynamique.

```prisma
model SystemConfig {
  id            String    @id @default(cuid())
  key           String    @unique              // ex: "YELII_WEBHOOK_URL"
  value         String    @db.Text             // la valeur actuelle
  category      ConfigCategory                 // pour grouper dans l'interface
  label         String                         // libellé humain affiché dans l'UI
  description   String?   @db.Text             // aide contextuelle affichée dans l'UI
  isSecret      Boolean   @default(false)       // si true → masqué dans l'UI (••••), jamais en clair
  isEditable    Boolean   @default(true)        // certaines valeurs calculées ne sont pas éditables à la main
  updatedAt     DateTime  @updatedAt
  updatedBy     String?                         // userId du DEVELOPER qui a fait le changement

  @@index([category])
}

enum ConfigCategory {
  WEBHOOKS              // URLs de callback
  INTEGRATION_KEYS       // clés API externes
  FINANCIAL              // taux, commissions
  INFRASTRUCTURE         // URLs de base, CORS
  SYSTEM_BEHAVIOR         // délais, fréquences
  NOTIFICATIONS           // sons, templates
  FEATURE_FLAGS           // interrupteurs on/off
}

// Historique des changements — traçabilité demandée explicitement
model SystemConfigHistory {
  id            String    @id @default(cuid())
  configKey     String                          // référence à SystemConfig.key
  oldValue      String?   @db.Text
  newValue      String    @db.Text
  changedBy     String                          // userId du DEVELOPER
  changedByName String                          // snapshot du nom au moment du changement
  reason        String?   @db.Text              // note optionnelle du développeur
  createdAt     DateTime  @default(now())

  @@index([configKey])
  @@index([createdAt])
}
```

**Ce qui NE va JAMAIS dans cette table, pour la sécurité** (rappel de la règle établie) :
- `JWT_SECRET`, `REFRESH_TOKEN_SECRET` — restent uniquement dans `.env`, jamais en base, jamais affichés
- Mot de passe de connexion PostgreSQL — reste dans `.env`
- Tout secret dont la fuite compromettrait directement l'authentification du système entier

Pour les clés d'intégration externes (Yelii, MTN, Twilio, etc.), elles PEUVENT être en base avec `isSecret: true` — masquées à l'affichage (••••) mais utilisables par le système, car leur fuite est grave mais pas aussi catastrophique qu'une fuite de JWT_SECRET (qui compromettrait toutes les sessions de tous les utilisateurs).

---

## 3. LE SERVICE DE CONFIGURATION CENTRALISÉ

C'est la pièce technique la plus importante de cette fonctionnalité. **Aucun fichier du projet ne doit plus lire `process.env.YELII_API_KEY` directement** — tout doit passer par ce service.

```typescript
// apps/api/src/services/config.service.ts

import { prisma } from '../lib/prisma'

// Cache en mémoire pour éviter une requête DB à chaque appel
// Invalidé automatiquement quand une valeur est modifiée (voir updateConfig)
const configCache = new Map<string, string>()
let cacheLoaded = false

/**
 * Charge toute la configuration en cache au démarrage du serveur.
 * À appeler une fois dans apps/api/src/index.ts au démarrage.
 */
export async function loadConfigCache() {
  const configs = await prisma.systemConfig.findMany()
  configs.forEach(c => configCache.set(c.key, c.value))
  cacheLoaded = true
  console.log(`[Config] ${configs.length} paramètres chargés en cache`)
}

/**
 * Lit une valeur de configuration.
 * Ordre de priorité : 1. Base de données (cache)  2. .env (fallback)  3. valeur par défaut
 *
 * C'EST CETTE FONCTION QUI REMPLACE process.env.XXX PARTOUT DANS LE CODE MÉTIER.
 */
export function getConfig(key: string, fallbackToEnv = true): string | undefined {
  if (configCache.has(key)) {
    return configCache.get(key)
  }
  if (fallbackToEnv && process.env[key]) {
    return process.env[key]
  }
  return undefined
}

/**
 * Modifie une valeur de configuration.
 * Écrit en base, invalide le cache, et enregistre l'historique.
 */
export async function updateConfig(
  key: string,
  newValue: string,
  changedBy: { id: string; fullName: string },
  reason?: string
) {
  const existing = await prisma.systemConfig.findUnique({ where: { key } })

  await prisma.$transaction([
    prisma.systemConfig.upsert({
      where: { key },
      update: { value: newValue, updatedBy: changedBy.id },
      create: {
        key, value: newValue,
        category: 'INFRASTRUCTURE', // ajusté selon le contexte réel d'appel
        label: key, updatedBy: changedBy.id,
      },
    }),
    prisma.systemConfigHistory.create({
      data: {
        configKey: key,
        oldValue: existing?.value,
        newValue,
        changedBy: changedBy.id,
        changedByName: changedBy.fullName,
        reason,
      },
    }),
  ])

  // Invalider le cache immédiatement — pas besoin de redémarrer le serveur
  configCache.set(key, newValue)
}

/**
 * Récupère tout l'historique des changements pour une clé donnée.
 * Utilisé pour afficher "Historique" dans le panneau développeur.
 */
export async function getConfigHistory(key: string) {
  return prisma.systemConfigHistory.findMany({
    where: { configKey: key },
    orderBy: { createdAt: 'desc' },
  })
}
```

**Exemple concret de migration d'un fichier existant** — le service Yelii (déjà créé selon `PAYMENT_FLOWS_SGM_CEM.md`) doit être modifié ainsi :

```typescript
// apps/api/src/services/yelii.service.ts — AVANT (à corriger)
const BASE_URL = process.env.YELII_BASE_URL!
const API_KEY  = process.env.YELII_API_KEY!

// APRÈS (avec le service de config)
import { getConfig } from './config.service'

function getYeliiConfig() {
  return {
    baseUrl: getConfig('YELII_BASE_URL')!,
    apiKey: getConfig('YELII_API_KEY')!,
    webhookUrl: getConfig('YELII_WEBHOOK_URL')!,
  }
}
// Appeler getYeliiConfig() au début de chaque fonction du service,
// jamais de constante figée au chargement du module — sinon le changement
// en base ne serait pris en compte qu'après redémarrage, ce qui annule
// tout l'intérêt de cette fonctionnalité.
```

---

## 4. LE BOUTON "RECALCULER L'URL DE WEBHOOK" — LE CAS D'USAGE DE DÉPART

### Ce qu'il fait exactement

```
┌─────────────────────────────────────────────────────────────┐
│  🔗 Webhook Yelii                                            │
│                                                              │
│  URL actuelle :                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ https://a1b2c3d4.ngrok-free.app/webhooks/yelii       │  │
│  └──────────────────────────────────────────────────────┘  │
│  Dernière mise à jour : 16 juin 2026 à 14h32 par DevNet     │
│                                                              │
│  Nouvelle base d'URL (domaine ou tunnel actuel)              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ https://nouveau-tunnel.ngrok-free.app                │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Note (optionnel)                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Migration vers Oracle Cloud                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  [🔄 Recalculer & Enregistrer]        [📋 Voir l'historique] │
└─────────────────────────────────────────────────────────────┘
```

### Logique exacte du bouton "Recalculer & Enregistrer"

```typescript
// apps/api/src/routes/developer.ts

router.post('/config/webhook/recalculate', requireDeveloper, async (req, res) => {
  const { newBaseUrl, reason } = req.body
  // newBaseUrl = ce que l'utilisateur colle, ex: "https://nouveau-tunnel.ngrok-free.app"

  // 1. Nettoyer l'URL (retirer un éventuel slash final)
  const cleanBase = newBaseUrl.replace(/\/$/, '')

  // 2. Construire l'URL complète du webhook
  const fullWebhookUrl = `${cleanBase}/webhooks/yelii`

  // 3. Enregistrer en base + historique (via le service de config)
  await updateConfig(
    'YELII_WEBHOOK_URL',
    fullWebhookUrl,
    { id: req.user.id, fullName: req.user.fullName },
    reason
  )

  // 4. Optionnel — si Yelii propose une API pour mettre à jour le webhook
  //    configuré dans leur dashboard (à vérifier dans leur doc), l'appeler ici.
  //    Sinon, afficher un rappel à l'utilisateur de le faire manuellement.

  // 5. Retourner la nouvelle URL complète pour affichage + rappel d'action manuelle
  return res.json({
    success: true,
    data: {
      webhookUrl: fullWebhookUrl,
      manualActionRequired: 'Copiez cette URL dans le tableau de bord Yelii (https://api.yelii.xyz/dashboard) si un champ webhook global y est configuré.',
    },
  })
})
```

### Le composant "Voir l'historique"

```
┌─────────────────────────────────────────────────────────────┐
│  Historique — YELII_WEBHOOK_URL                              │
│                                                              │
│  16 juin 2026, 14h32 — DevNet                                │
│  https://ancien-tunnel.ngrok.io/webhooks/yelii               │
│  → https://a1b2c3d4.ngrok-free.app/webhooks/yelii           │
│  Note : "Redémarrage ngrok"                                  │
│                                                              │
│  10 juin 2026, 09h15 — DevNet                                │
│  https://localhost:3001/webhooks/yelii (valeur .env initiale)│
│  → https://ancien-tunnel.ngrok.io/webhooks/yelii             │
│  Note : "Premier tunnel de test"                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. STRUCTURE COMPLÈTE DE L'INTERFACE — TOUTES LES SECTIONS

Le panneau développeur est une nouvelle page accessible uniquement au rôle DEVELOPER, avec un menu latéral propre à ce rôle (distinct de la sidebar normale). Voici les 7 sections, avec la liste exhaustive de ce qui est gérable dans chacune.

### Section A — Webhooks & Callbacks
```
- URL webhook Yelii (avec bouton recalculer, section 4)
- URL webhook MTN MoMo (si activé un jour)
- URL webhook Orange Money (si activé un jour)
- URL de retour après paiement (return_url)
```

### Section B — Clés d'intégration (isSecret: true, affichage masqué ••••)
```
- Clé API Yelii
- MTN : subscription key, API user, API key
- Orange Money : client ID, client secret, merchant key
- WhatsApp 360Dialog : clé API
- Twilio : account SID, auth token, numéro d'envoi
- S3 : bucket name, access key, secret key, endpoint, region
- Google OAuth : client ID
- SMTP : host, port, user, mot de passe, adresse d'envoi
```
Chaque champ secret a un bouton "Afficher" (demande confirmation) et "Tester la connexion" quand c'est possible (ex: appeler `/wallet/balance` de Yelii pour vérifier que la clé fonctionne).

### Section C — Paramètres financiers dynamiques
```
- Taux de commission Yelii actuel (2.5% — modifiable si Yelii change son taux)
- Taux d'augmentation annuel des cotisations
- Ratio étudiant / travailleur
- Ratio couple / travailleur
```
Note : ces derniers existent peut-être déjà dans "Paramètres Système" (Admin) — à harmoniser, pas dupliquer. Le panneau développeur peut simplement pointer vers cette page existante pour ces valeurs-là, et se concentrer sur le taux de commission Yelii qui est nouveau.

### Section D — Infrastructure & réseau
```
- URL de base de l'application (APP_URL)
- URL de base de l'API (API_URL)
- Origines CORS autorisées (liste éditable)
- Mode maintenance (interrupteur on/off + message personnalisé)
```

### Section E — Comportement système
```
- Délai avant rappel de paiement en retard (jours)
- Délai avant alerte "fonds chez collecteur trop longtemps"
- Fréquence du job de réconciliation Yelii (minutes)
- Interrupteur : Mobile Money activé / désactivé
- Interrupteur : Espèces activé / désactivé
- Niveau de log (debug / info / warning / error)
```

### Section F — Notifications
```
- Liste des sons de notification disponibles (ajout/suppression de fichiers)
- Templates WhatsApp (édition du texte des 4 templates de PAYMENT_FLOWS_SGM_CEM.md)
- Interrupteur : WhatsApp activé / désactivé
- Interrupteur : SMS activé / désactivé
- Interrupteur : Email activé / désactivé
```

### Section G — Feature flags
```
- Mode hors ligne PWA : activé / désactivé
- Query builder avancé : activé / désactivé
- Répartition par pourcentage (Partie E) : activé / désactivé
```

---

## 6. SEED — VALEURS INITIALES DEPUIS .env

Au premier démarrage, un script doit copier les valeurs actuelles du `.env` vers la table `SystemConfig`, pour que la transition soit transparente et qu'aucune configuration existante ne soit perdue.

```typescript
// apps/api/prisma/seed-config.ts

const initialConfigs = [
  { key: 'YELII_WEBHOOK_URL', category: 'WEBHOOKS', label: 'URL Webhook Yelii', isSecret: false },
  { key: 'YELII_API_KEY', category: 'INTEGRATION_KEYS', label: 'Clé API Yelii', isSecret: true },
  { key: 'YELII_BASE_URL', category: 'INTEGRATION_KEYS', label: 'URL de base Yelii', isSecret: false },
  { key: 'APP_URL', category: 'INFRASTRUCTURE', label: 'URL de l\'application', isSecret: false },
  { key: 'API_URL', category: 'INFRASTRUCTURE', label: 'URL de l\'API', isSecret: false },
  // ... reprendre CHAQUE variable listée en section 5, sauf les secrets exclus (section 2)
]

async function seedConfig() {
  for (const conf of initialConfigs) {
    const envValue = process.env[conf.key]
    if (!envValue) continue // pas de valeur .env → ne pas créer d'entrée vide

    await prisma.systemConfig.upsert({
      where: { key: conf.key },
      update: {}, // ne pas écraser si déjà présent (idempotent)
      create: {
        key: conf.key,
        value: envValue,
        category: conf.category as any,
        label: conf.label,
        isSecret: conf.isSecret,
      },
    })
  }
  console.log('[Seed Config] Configuration initiale copiée depuis .env')
}
```

---

## 7. AUDIT — TRAÇABILITÉ SPÉCIFIQUE

En plus de `SystemConfigHistory` (section 2) qui trace chaque changement de valeur, chaque accès au panneau développeur doit être audité dans le `AuditLog` général déjà existant du projet (voir `CLAUDE.md`), avec une action explicite :

```typescript
await prisma.auditLog.create({
  data: {
    userId: req.user.id,
    action: 'DEVELOPER_PANEL_CONFIG_CHANGED',
    entity: 'SystemConfig',
    entityId: key,
    before: JSON.stringify({ value: oldValue }),
    after: JSON.stringify({ value: newValue }),
  },
})
```

---

## 8. ORDRE D'IMPLÉMENTATION

```
1. Ajouter DEVELOPER dans l'enum Role + migration Prisma
2. Créer les modèles SystemConfig et SystemConfigHistory + migration
3. Créer config.service.ts (section 3) avec cache + fallback .env
4. Créer le script de seed depuis .env (section 6) et l'exécuter une fois
5. Migrer TOUS les process.env.XXX critiques du code vers getConfig()
   → Commencer par YELII_WEBHOOK_URL, YELII_API_KEY (le cas prioritaire)
   → Puis MTN, Orange, Twilio, S3, etc.
6. Créer les routes API du panneau développeur (une par section A-G)
7. Créer l'interface frontend — page développeur avec les 7 sections
8. Implémenter le bouton "Recalculer & Enregistrer" (section 4)
9. Implémenter l'affichage d'historique (SystemConfigHistory)
10. Tester : changer YELII_WEBHOOK_URL depuis l'interface, vérifier que le
    prochain appel Yelii utilise la nouvelle URL SANS redémarrer le serveur
11. Mettre à jour CLAUDE.md avec le nouveau rôle, le modèle SystemConfig,
    et la règle "toute config technique passe par config.service.ts"
```

---

*Document de référence — Panneau Développeur SGM-CEM*
*Culte d'Enfants de Melen · EEC Melen · Yaoundé, Cameroun*
*La base de données est la source de vérité à l'exécution. Le .env n'est qu'un secours au premier démarrage.*
