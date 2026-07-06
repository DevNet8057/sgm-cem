# PROMPT MAÎTRE — CLAUDE CODE
## SGM-CEM · Système de Gestion du Ministère
## Culte d'Enfants de Melen · EEC Yaoundé · Version 4.1

---

## SUIVI D'IMPLEMENTATION LOCAL

Etat au 2026-06-05 :

Le noyau fonctionnel prioritaire couvre maintenant :

- Authentification email / mot de passe avec JWT.
- Dashboard connecte aux statistiques backend.
- Membres : liste, recherche, creation de membre et audit de creation.
- Rubriques : liste, recherche, creation, edition, ouverture, fermeture et archivage de rubrique.
- Contributions : liste, filtre par statut, creation de paiement, calcul du montant attendu selon le profil financier.
- Validations : ecran dedie pour confirmer une contribution ou la passer en litige.
- Fonds Collecteurs : synthese des fonds confirmes non reverses, alertes de retention, selection et transfert vers caisse ou banque.
- Litiges : liste des contributions contestees, resolution par confirmation ou annulation avec audit.
- Statistiques : page dediee avec KPI et graphique mensuel.
- Rapports : exports CSV pour membres, rubriques et contributions.
- Rapports PDF/impression : rapport financier annuel avec KPI, moyens de paiement, top contributeurs et taux par rubrique.
- Notifications : backend securise, liste frontend, compteur non-lu, marquer une notification lue, tout marquer lu et broadcast responsable/admin.
- Parametres systeme : ecran frontend, lecture/mise a jour securisee, audit des modifications, ratios financiers, delais de rappel et retention.
- Prestations de genie : creation, suivi des cours/depenses, enregistrement des entrees, cloture des entrees et calcul/versement de commission.
- GED Commissions : liste commissions/documents, creation de fiche document, soumission, approbation, rejet motive et archivage avec audit.
- Dashboard interactif : filtre par annee, collectes mensuelles, taux de confirmation, moyens de paiement, top contributeurs et taux par rubrique.
- Import membres : CSV Excel avec virgule ou point-virgule, en-tetes francais/anglais et modele telechargeable.
- Backend : RBAC serveur sur les routes du noyau, audit log sur creation membre, creation contribution, confirmation et litige.
- Securite : secrets JWT centralises, refus des secrets faibles en production, RBAC serveur sur les routes sensibles du noyau.
- Base PostgreSQL : schema synchronise avec Prisma et seed fonctionnel.

Modules encore hors noyau ou incomplets :

- OTP telephone / SMS.
- Paiements MTN MoMo, Orange Money, CinetPay et webhooks.
- Upload fichier reel S3 pour GED, previsualisation et telechargement securise.
- Notifications temps reel, WhatsApp, SMS, Web Push.
- Mode offline collecteur avec IndexedDB et synchronisation.
- Tests automatises, CI/CD et deploiement production.

Priorite de developpement restante :

1. Durcir les validations metier du noyau.
2. Ajouter de vraies donnees de demonstration ou un import Excel membres.
3. Ajouter tests API sur membres, rubriques, contributions et validations.
4. Ajouter tests automatises API sur le noyau.
5. Ajouter des tests automatises API sur notifications, rapports, statistiques, parametres et prestations.
6. Ensuite seulement passer aux paiements, GED avancee et notifications temps reel.

---

## TA MISSION

Tu es un architecte full-stack senior qui construit **SGM-CEM**, une Progressive Web App de gestion financière et administrative pour le Culte d'Enfants de Melen (Église Évangélique du Cameroun, Yaoundé). L'application gère les contributions des membres, les rubriques, les collecteurs, la GED des commissions et les prestations de génie.

**PREMIÈRE ACTION OBLIGATOIRE** : Lis le fichier `CLAUDE.md` (disponible dans le projet). Il contient l'architecture complète, le design system EEC, les règles métier RB-01 à RB-22, le schéma Prisma complet et toutes les spécifications. Ne code rien sans l'avoir lu.

---

## CONTEXTE TECHNIQUE COMPLET

### Stack
```
Frontend : Next.js 15 (App Router) · TypeScript 5 strict · Tailwind CSS 4
           Zustand 5 · TanStack Query 5 · React Hook Form + Zod
           Recharts 2 · Framer Motion 11 · Lucide React · Radix UI

Backend  : Node.js 20 LTS · Express.js 4 · TypeScript 5 · Prisma 5
           PostgreSQL 16 · Redis 7 · BullMQ 5 · Puppeteer 21

Paiements: MTN MoMo API · Orange Money Africa · CinetPay (XAF)
Notifs   : 360Dialog WhatsApp Business · Twilio SMS · Web Push VAPID
Storage  : S3-compatible (4 buckets : ged / receipts / prestations / materiels)
Hébergement : Hetzner Cloud · Nginx · PM2 · GitHub Actions CI/CD
```

### Identité visuelle EEC (NON NÉGOCIABLE)
```
Vert foncé  : #0F4A0F  → fond sidebar, headers H1
Vert moyen  : #1A6B1A  → boutons CTA, liens, icônes actives
Jaune vif   : #F5C400  → accent principal, item actif sidebar, badges
Police display : Cormorant Garamond (titres, grandes valeurs numériques)
Police body    : Plus Jakarta Sans (corps, navigation, labels)
Police mono    : JetBrains Mono (IDs, montants, codes)
```

### Structure du projet
```
sgm-cem/
├── apps/
│   ├── web/          → Next.js 15 PWA
│   └── api/          → Express.js API
├── packages/shared/  → Types TypeScript partagés
├── CLAUDE.md         → Référence architecturale (LIRE EN PREMIER)
└── .env              → Variables d'environnement
```

---

## DONNÉES DE RÉFÉRENCE (Analyse Excel 2025)

```
Membres actifs          : 106 (jan: 71 → déc: 106)
Catégories              : MCE EN SERVICE · ENFANTS · DIASPORA
Groupes géographiques   : Temple · Mvog Betsi · Biscuiterie · Obili · Sciences · Polytechnique
Rubriques préconfigurées: CD (1000F) · CM (2400-3000F) · CA-Mariage · CA-Bébé · CA-Deuil
                          CA-Grenier · CA-Autres · CRP (1000F) · DR · CP · DSAI
Objectif MCE 2025       : 4 228 000 FCFA → atteint à 200%
Objectif Enfants 2025   : 1 300 000 FCFA → atteint à 91%
Profils financiers      : Travailleur (100%) · Étudiant (50%) · Couple (150%)
Devise                  : FCFA / XAF — Cameroun
```

---

## RÈGLES ABSOLUES

### À toujours faire
- Lire `CLAUDE.md` avant toute chose
- TypeScript strict — zéro `any`, zéro `as unknown`
- Mobile-first — chaque composant pensé pour Android 8 en 3G
- Animations présentes sur tous les états : hover, focus, loading, erreur
- Skeleton loaders sur tous les fetches de données
- RBAC vérifié **côté serveur** sur chaque endpoint API
- Utiliser `formatAmount()` pour tous les montants (Intl.NumberFormat XAF)
- Créer un `AuditLog` pour toutes les actions sensibles
- **Toute configuration technique passe par `services/config.service.ts`** (`getConfig()` appelé AU MOMENT de l'usage, jamais de constante figée au chargement du module) — la table `SystemConfig` est la source de vérité à l'exécution, `.env` n'est qu'un secours au premier démarrage (voir `DEVELOPER_PANEL_SGM_CEM.md`)

### À ne jamais faire
- Utiliser Arial, Inter, Roboto comme police principale
- Créer des gradients violets ou génériques — uniquement les couleurs EEC
- Calculer `createdAt` côté client (RB-01)
- Hard-delete de données financières (RB-14)
- Confirmer un paiement MoMo/Orange sans webhook (RB-02)
- Oublier les animations et micro-interactions
- Vérifier les permissions uniquement côté client
- Lire `process.env.XXX` directement dans le code métier (→ `getConfig()`)
- Mettre `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `CSRF_SECRET` ou `DATABASE_URL` dans `SystemConfig` — ces secrets restent EXCLUSIVEMENT dans `.env`, jamais en base, jamais affichés
- Protéger une route du panneau développeur avec `requireLevel(5)` — toujours `requireDeveloper` (même ADMIN n'y accède pas)

---

## RÔLE DEVELOPER + CONFIGURATION DYNAMIQUE (2026-07-05)

Hiérarchie : **DEVELOPER (6)** > ADMIN (5) > TRESORIER (4) > RESPONSABLE / ADJOINT_RESPONSABLE (3) > COLLECTEUR (2) > MEMBRE (1).

- DEVELOPER = mainteneur technique. Il conserve tous les accès ADMIN (les checks `requireRole('ADMIN', 'DEVELOPER')` et les listes de rôles l'incluent) **plus** le panneau développeur (`/api/developer/*`, vue `Developer.tsx`, item sidebar « Développeur »).
- Un ADMIN ne peut ni attribuer le rôle DEVELOPER (absent des `z.enum` de users.ts) ni modifier/désactiver/réinitialiser un compte DEVELOPER (`assertCanManageTarget`).
- Élévation : `apps/api/prisma/seed-config.ts` (variable `DEVELOPER_EMAIL`, défaut `ADMIN_EMAIL`).

**Modèles** : `SystemConfig` (clé-valeur, `category` ∈ 7 sections A-G, `isSecret` → masqué ••••, `isEditable`) + `SystemConfigHistory` (traçabilité) + `AuditAction.DEVELOPER_PANEL_CONFIG_CHANGED`.

**Service** : `services/config.service.ts` — `loadConfigCache()` au démarrage (index.ts), `getConfig/getConfigBool/getConfigNumber` (cache → fallback .env), `updateConfig()` (base + historique + audit en transaction, invalidation immédiate du cache → **aucun redémarrage nécessaire**). Clients reconstruits sur changement de config : SMTP (email.ts), Twilio (notification.ts), S3 (storage.ts), Google OAuth (auth.ts).

**Cas d'usage de référence** : `POST /api/developer/config/webhook/recalculate` — recalcule `YELII_WEBHOOK_URL` depuis une nouvelle base (tunnel/domaine) ; le prochain appel Yelii l'utilise immédiatement (prouvé par `scripts/proof-no-restart.cjs`).

**Taux de commission Yelii** : clé `YELII_COMMISSION_RATE` (base) passée en paramètre à `calculateAmountWithCommission(due, rate)` — la formule reste UNIQUE dans `packages/shared`. Le frontend lit le taux effectif via `GET /api/payments/config`.

**Impersonation** : le DEVELOPER peut se connecter à n'importe quel compte via le bouton « Connecter » de Gestion des utilisateurs. `POST /api/developer/impersonate/:userId` (requireDeveloper — cible active, jamais un DEVELOPER) pose un jeton 1 h marqué `impersonatedBy` ; bandeau permanent + `POST /api/auth/stop-impersonation` pour revenir. Chaque bascule est auditée (`AuditAction.IMPERSONATE`). En impersonation : `mustChangePassword` neutralisé, panneau développeur inaccessible (le rôle du jeton est celui de la cible).

---

## PLAN DE DÉVELOPPEMENT — 8 PHASES

---

### PHASE 1 · FONDATIONS & CONFIGURATION
**Durée estimée : 2 jours**

#### 1.1 Initialisation du monorepo

```bash
# Turborepo ou pnpm workspaces
pnpm create turbo@latest sgm-cem

# Frontend
cd apps/web
pnpm add zustand @tanstack/react-query react-hook-form zod
pnpm add @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-dropdown-menu
pnpm add @radix-ui/react-toast @radix-ui/react-tabs @radix-ui/react-switch
pnpm add lucide-react recharts framer-motion
pnpm add clsx tailwind-merge
pnpm add -D @types/node

# Backend
cd apps/api
pnpm add express prisma @prisma/client
pnpm add jsonwebtoken bcrypt zod helmet cors
pnpm add bullmq ioredis
pnpm add puppeteer @aws-sdk/client-s3 multer
pnpm add express-rate-limit
pnpm add -D typescript @types/express @types/node @types/jsonwebtoken @types/bcrypt ts-node nodemon
```

#### 1.2 tailwind.config.ts — Configuration complète

```typescript
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        cem: {
          'green-950': '#031403',
          'green-900': '#052005',
          'green-800': '#0F4A0F',
          'green-700': '#1A6B1A',
          'green-600': '#2D8C2D',
          'green-500': '#3DAA3D',
          'green-100': '#D4EDD4',
          'green-50':  '#E8F5E8',
          'green-25':  '#F0FDF4',
          'yellow-600': '#C4A000',
          'yellow-500': '#D4A800',
          'yellow-400': '#F5C400',
          'yellow-100': '#FDE68A',
          'yellow-50':  '#FEFCE8',
        }
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        body:    ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        'xs': '4px', 'sm': '6px', 'md': '10px',
        'lg': '14px', 'xl': '18px', '2xl': '24px', '3xl': '28px',
      },
      boxShadow: {
        'cem-sm':     '0 2px 8px rgba(26,107,26,0.12)',
        'cem':        '0 4px 16px rgba(26,107,26,0.18)',
        'cem-lg':     '0 8px 32px rgba(15,74,15,0.14)',
        'cem-xl':     '0 20px 60px rgba(15,74,15,0.18)',
        'cem-yellow': '0 4px 20px rgba(245,196,0,0.35)',
        'inner-cem':  'inset 0 2px 8px rgba(26,107,26,0.06)',
      },
      animation: {
        'page-enter':    'page-enter 0.4s cubic-bezier(0.4,0,0.2,1) both',
        'slide-up':      'slide-up 0.35s cubic-bezier(0.4,0,0.2,1) both',
        'modal-in':      'modal-in 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        'toast-in':      'toast-in 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        'skeleton':      'skeleton 1.5s ease-in-out infinite',
        'urgence-pulse': 'urgence-pulse 2s ease-in-out infinite',
        'float':         'float 3s ease-in-out infinite',
        'pop':           'pop-in 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        'spin-smooth':   'spin 0.8s linear infinite',
        'ping-slow':     'ping 2s cubic-bezier(0,0,0.2,1) infinite',
        'shimmer':       'shimmer 2s linear infinite',
      },
      keyframes: {
        'page-enter':    { from: { opacity:'0', transform:'translateY(12px)' }, to: { opacity:'1', transform:'translateY(0)' } },
        'slide-up':      { from: { opacity:'0', transform:'translateY(20px)' }, to: { opacity:'1', transform:'translateY(0)' } },
        'modal-in':      { from: { opacity:'0', transform:'translateY(40px) scale(0.97)' }, to: { opacity:'1', transform:'none' } },
        'toast-in':      { from: { opacity:'0', transform:'translateX(100%)' }, to: { opacity:'1', transform:'none' } },
        'skeleton':      { '0%': { backgroundPosition:'-200% 0' }, '100%': { backgroundPosition:'200% 0' } },
        'urgence-pulse': { '0%,100%': { boxShadow:'0 0 0 0 rgba(239,68,68,0.4)' }, '50%': { boxShadow:'0 0 0 8px rgba(239,68,68,0)' } },
        'float':         { '0%,100%': { transform:'translateY(0)' }, '50%': { transform:'translateY(-6px)' } },
        'pop-in':        { from: { opacity:'0', transform:'scale(0.92)' }, to: { opacity:'1', transform:'none' } },
        'shimmer':       { '0%': { backgroundPosition:'-200% 0' }, '100%': { backgroundPosition:'200% 0' } },
      },
    },
  },
  plugins: [],
} satisfies Config
```

#### 1.3 globals.css

```css
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --sidebar-w: 260px;
    --topbar-h: 64px;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    background: #F0FDF4;
    color: #0F172A;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
}

@layer utilities {
  .font-display { font-family: 'Cormorant Garamond', Georgia, serif; }
  .font-mono    { font-family: 'JetBrains Mono', monospace; }

  /* Skeleton loader */
  .skeleton {
    background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
    background-size: 200% 100%;
    animation: skeleton 1.5s ease-in-out infinite;
  }

  /* Cross pattern EEC background */
  .cross-bg {
    background-image: url("data:image/svg+xml,%3Csvg width='32' height='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M14 0h4v14h14v4H18v14h-4V18H0v-4h14z' fill='%23F5C400' fill-opacity='0.04'/%3E%3C/svg%3E");
  }

  /* Stagger animation children */
  .stagger-children > * { animation: page-enter 0.4s cubic-bezier(0.4,0,0.2,1) both; }
  .stagger-children > *:nth-child(1) { animation-delay: 0ms; }
  .stagger-children > *:nth-child(2) { animation-delay: 60ms; }
  .stagger-children > *:nth-child(3) { animation-delay: 120ms; }
  .stagger-children > *:nth-child(4) { animation-delay: 180ms; }
  .stagger-children > *:nth-child(5) { animation-delay: 240ms; }
  .stagger-children > *:nth-child(6) { animation-delay: 300ms; }

  /* Scrollbar slim */
  .scrollbar-thin::-webkit-scrollbar { width: 4px; height: 4px; }
  .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
  .scrollbar-thin::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 2px; }
  .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: #94A3B8; }

  /* Safe area */
  .pb-safe { padding-bottom: max(8px, env(safe-area-inset-bottom)); }
}
```

#### 1.4 Schéma Prisma complet

Copie intégralement le schéma de la **section 15 du CLAUDE.md** dans `apps/api/prisma/schema.prisma`. Il contient les 20 modèles et 18 enums nécessaires.

#### 1.5 Seed de la base de données

```typescript
// apps/api/prisma/seed.ts
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  // 1. Admin par défaut
  const hashedPassword = await bcrypt.hash('ChristEst!2026', 12)
  await prisma.user.upsert({
    where: { email: 'admin@cem-melen.cm' },
    update: {},
    create: {
      firstName: 'Administrateur', lastName: 'CEM', fullName: 'Administrateur CEM',
      email: 'admin@cem-melen.cm', passwordHash: hashedPassword,
      role: 'ADMIN', isActive: true, memberId: 'CEM-2026-000001',
    }
  })

  // 2. Paramètres système (singleton)
  await prisma.systemSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      defaultIncreaseRate: 5.0,
      etudiantRatio: 0.5,
      coupleRatio: 1.5,
      inactivityMonthsThreshold: 6,
      reminderDelayDays: 7,
      maxFundsRetentionDays: 7,
      communityName: "Culte d'Enfants de Melen",
      communityVerse: "Or, à celui qui peut faire, par la puissance qui agit en nous, infiniment au-delà de tout ce que nous demandons ou pensons — Eph. 2:20",
    }
  })

  // 3. Les 11 rubriques préconfigurées 2025
  const rubriques = [
    { code:'CD-2025',        title:'Contribution District 2025',           type:'REGULIERE_MENSUELLE', amountTravailleur:1000, amountEtudiant:1000, amountCouple:1000 },
    { code:'CM-2025',        title:'Contribution Mensuelle 2025',          type:'REGULIERE_MENSUELLE', amountTravailleur:3000, amountEtudiant:1500, amountCouple:4500 },
    { code:'CA-MARIAGE',     title:'Assistance Mariage',                   type:'PONCTUELLE',          amountTravailleur:2000, amountEtudiant:1000, amountCouple:2000 },
    { code:'CA-BEBE',        title:'Assistance Naissance',                 type:'PONCTUELLE',          amountTravailleur:500,  amountEtudiant:500,  amountCouple:500  },
    { code:'CA-DEUIL',       title:'Assistance Deuil',                     type:'URGENTE',             amountTravailleur:null, amountEtudiant:null, amountCouple:null },
    { code:'CA-GRENIER',     title:'Aide Alimentaire (Grenier)',           type:'PONCTUELLE',          amountTravailleur:null, amountEtudiant:null, amountCouple:null },
    { code:'CA-AUTRES',      title:'Contributions Assistance Diverses',    type:'PONCTUELLE',          amountTravailleur:null, amountEtudiant:null, amountCouple:null },
    { code:'CRP-2025',       title:'Collectes Regroupées Paroissiales 2025',type:'REGULIERE_MENSUELLE',amountTravailleur:1000, amountEtudiant:1000, amountCouple:1000 },
    { code:'DR-2025',        title:'Don de Reconnaissance 2025',           type:'PONCTUELLE',          amountTravailleur:null, amountEtudiant:null, amountCouple:null },
    { code:'CP-2025',        title:'Contribution Projet 2025',             type:'PONCTUELLE',          amountTravailleur:null, amountEtudiant:null, amountCouple:null },
    { code:'DSAI-2025',      title:'Don Soutien Activités Internes 2025',  type:'PONCTUELLE',          amountTravailleur:null, amountEtudiant:null, amountCouple:null },
  ]
  for (const r of rubriques) {
    await prisma.rubrique.upsert({
      where: { code: r.code }, update: {},
      create: { ...r, description: `Rubrique ${r.title}`, status:'OUVERTE', priority:'NORMAL',
        openDate: new Date('2025-01-01'), fiscalYear: 2025, isAnnualReference: true,
        createdById: 'seed', createdByName: 'Système', targetAll: true },
    })
  }

  // 4. Commissions GED
  const commissions = [
    { nom: 'Finance & Trésorerie',       description: 'Gestion financière et comptable' },
    { nom: 'Communication & Médias',     description: 'Communication interne et externe' },
    { nom: 'Évangélisation & Missions',  description: 'Activités missionnaires' },
    { nom: 'Jeunesse & Culte d\'Enfants',description: 'Activités jeunesse' },
  ]
  for (const comm of commissions) {
    const existing = await prisma.commission.findFirst({ where: { nom: comm.nom } })
    if (!existing) await prisma.commission.create({ data: { ...comm, responsableId: 'seed' } })
  }

  // 5. Types de documents GED
  const typeDocs = [
    { code:'RPT',   libelle:'Rapport',              retentionAnnees:7  },
    { code:'FAC',   libelle:'Facture',              retentionAnnees:10 },
    { code:'PV',    libelle:'Procès-Verbal',        retentionAnnees:10 },
    { code:'PLAN',  libelle:'Plan / Programme',     retentionAnnees:5  },
    { code:'BILAN', libelle:'Bilan',                retentionAnnees:10 },
    { code:'SUIVI', libelle:'Document de Suivi',    retentionAnnees:3  },
    { code:'INFO',  libelle:'Document d\'Information',retentionAnnees:2},
    { code:'AUTRE', libelle:'Autre',                retentionAnnees:5  },
  ]
  for (const td of typeDocs) {
    await prisma.typeDocument.upsert({ where:{ code:td.code }, update:{}, create:td })
  }

  console.log('✅ Seed terminé')
}

main().catch(console.error).finally(() => prisma.$disconnect())
```

---

### PHASE 2 · AUTHENTIFICATION
**Durée estimée : 2 jours**

#### Fonctionnalités à implémenter

**Page de connexion** (`src/app/(auth)/page.tsx`) :

```
Design :
  Desktop → 2 colonnes (panneau vert sombre gauche 420px + formulaire blanc)
  Mobile  → plein écran fond blanc, logo CEM centré

Panneau gauche :
  background: linear-gradient(160deg, #052005 0%, #0F4A0F 45%, #1A6B1A 100%)
  Pattern croix EEC (classe .cross-bg)
  Orbe radial jaune bas-gauche (opacity 8%)
  Logo CEM (carré jaune #F5C400 avec texte "CEM" en #0F4A0F)
  Titre Cormorant Garamond 40px : "Système de Gestion du Ministère"
  3 stats cards : "106+ membres" · "11 rubriques" · "100% traçabilité"
  Citation : "La Marche Ensemble dans l'Unité"

Formulaire :
  Toggle [Téléphone] / [Email] → tabs sur fond gray-100
  Mode téléphone : input tel → bouton "Recevoir le code SMS" → 6 cases OTP
  Mode email     : input email + mot de passe (toggle show/hide)
  Loading state  : spinner Loader2 sur le bouton
  Messages d'erreur inline sous les champs
```

**OTP 6 cases** — comportement précis :
```typescript
// Chaque case = un <input maxLength={1} />
// Auto-focus vers le suivant après saisie
// Backspace : vide la case ET focus vers la précédente si case déjà vide
// Paste : distribue automatiquement les 6 chiffres sur les cases
// Case remplie : bg-[#E8F5E8] text-[#1A6B1A] border-[#1A6B1A]
// Bouton "Valider" activé uniquement si les 6 cases sont remplies
// Compteur renvoi : 60 secondes décomptés
```

**Backend auth** :
```typescript
// POST /api/auth/otp/request  → génère OTP 6 chiffres, expire 5min, stocké Redis
// POST /api/auth/otp/verify   → vérifie OTP, retourne JWT access + refresh httpOnly
// POST /api/auth/login        → email + password → JWT
// POST /api/auth/refresh      → refresh token → nouveau access token
// POST /api/auth/logout       → blacklist le refresh token dans Redis
// Tokens : access 15min · refresh 7 jours httpOnly
// Anti-brute force : 5 tentatives → blocage 1h (Redis TTL)
```

---

### PHASE 3 · LAYOUT PRINCIPAL
**Durée estimée : 1 jour**

#### AppContext — structure exacte

```typescript
// src/contexts/AppContext.tsx
interface AppContextType {
  // Authentification
  user: User | null
  setUser: (u: User | null) => void
  logout: () => Promise<void>

  // Navigation
  activeView: string
  setActiveView: (v: string) => void
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void

  // Notifications temps réel
  notifications: Notification[]
  unreadCount: number
  urgentCount: number
  pendingConfirmations: number
  markRead: (id: string) => void
  markAllRead: () => void

  // Toast system
  addToast: (toast: ToastOptions) => void
}
```

#### Sidebar — implémentation

```typescript
// Design :
// background: linear-gradient(180deg, #052005 0%, #0F4A0F 30%, #1A6B1A 100%)
// Largeur : var(--sidebar-w) = 260px
// Mobile : translateX(-100%) → translateX(0) avec backdrop blur overlay

// Structure :
// ├── Header : Logo CEM (jaune) + nom organisation + card EEC
// ├── Nav sections (filtrées par rôle)
// │   ├── "TABLEAU DE BORD" — LayoutDashboard
// │   ├── "FINANCES"        — FolderOpen · CreditCard · Wallet · UserCheck
// │   ├── "MEMBRES"         — Users
// │   ├── "GESTION"         — Archive · Briefcase · AlertTriangle
// │   ├── "OUTILS"          — BarChart3 · FileText · Bell
// │   └── "SYSTÈME"         — Settings (ADMIN seulement)
// └── Footer : Avatar initiales jaunes + nom + rôle + déconnexion

// Item actif :
//   background: #F5C400 · color: #0F4A0F
//   indicator: barre verticale gauche 3px arrondie #0F4A0F opacity-60
//   shadow: 0 4px 16px rgba(245,196,0,0.3)

// Badges :
//   Compteur rouge (contributions en attente, notifications non lues)
//   Format : > 9 affiché comme "9+"
```

#### TopBar

```typescript
// bg-white/90 backdrop-blur-md sticky top-0 h-16 z-[200]
// border-b border-gray-100/80
// Contenu gauche → droite :
//   [Burger mobile] [Titre page + badge urgences rouge pill animé]
//   [Search bar desktop 208px avec "⌘K"] [Icône search mobile]
//   [Cloche + badge rouge unread] [Avatar initiales jaune + nom + rôle]
```

---

### PHASE 4 · DASHBOARD
**Durée estimée : 2 jours**

#### Composants à créer

**1. Banner d'accueil** :
```typescript
// gradient: linear-gradient(135deg, #0F4A0F 0%, #1A6B1A 60%, #2D8C2D 100%)
// Pattern cross-bg + orbe radial jaune -top-16 -right-16 opacity 8%
// Texte : "Bonjour 👋 {prenom}" en Cormorant Garamond 28px
// 2 cards stats fond rgba(255,255,255,0.10) :
//   "Ce mois"     → formatAmount(totalCollectedMonth)
//   "Cette année" → formatAmount(totalCollectedYear)
// Visible si canSeeFinancials (role niveau ≥ 3)
```

**2. KPI Cards** — hook useAnimatedCounter :
```typescript
function useAnimatedCounter(target: number, duration = 1200): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let start = 0
    const step = target / (duration / 16)
    const timer = setInterval(() => {
      start += step
      if (start >= target) { setCount(target); clearInterval(timer) }
      else setCount(Math.floor(start))
    }, 16)
    return () => clearInterval(timer)
  }, [target, duration])
  return count
}

// 4 cartes : Membres actifs | En retard | Confirmations | Fonds collecteurs
// hover → shadow-cem-lg + -translate-y-0.5
// accent bar top : gradient vert 4px
// orbe déco : w-24 h-24 rounded-full bg-cem-green-700/5 absolute -top-6 -right-6
```

**3. Progression rubriques** :
```typescript
// progressColor = (ratio) =>
//   ratio >= 0.8 ? '#1A6B1A' : ratio >= 0.5 ? '#D97706' : '#DC2626'
// progressGradient = (ratio) =>
//   ratio >= 0.8 ? 'linear-gradient(90deg,#1A6B1A,#2D8C2D)' :
//   ratio >= 0.5 ? 'linear-gradient(90deg,#D97706,#F59E0B)' :
//                  'linear-gradient(90deg,#DC2626,#EF4444)'
// Barre avec shimmer si ratio < 1 :
//   background-size: 200% 100%; animation: shimmer 2s linear infinite;
```

**4. Timeline activité récente** :
```typescript
// Icône mode paiement avec fond coloré :
//   MTN_MOMO     → bg-yellow-100 text-yellow-600 → "🟡"
//   ORANGE_MONEY → bg-orange-100 text-orange-600 → "🟠"
//   ESPECES      → bg-green-100  text-green-600  → "💵"
//   CARTE_VISA   → bg-blue-100   text-blue-600   → "💳"
// Nom + rubrique + montant (bold vert) + badge statut + timeAgo()
// Hover sur la ligne : bg-cem-green-700/4
// Clic → ouvre le détail de la contribution
```

**5. Actions rapides** — grid 4 boutons :
```typescript
// [+ Nouvelle rubrique]     → setActiveView('rubriques')
// [Enregistrer paiement]    → setActiveView('contributions')
// [+ Ajouter membre]        → setActiveView('members')
// [🚨 Rubrique urgente]     → modal création urgente directe
// Design : bordure dashed, fond hover coloré, icône dans carré arrondi
```

---

### PHASE 5 · MODULE CONTRIBUTIONS
**Durée estimée : 3 jours**

#### Stepper de paiement — 3 étapes

```typescript
// Étape 1 — Sélection
//   Autocomplete membre (recherche en temps réel)
//   Sélection rubrique avec montant pré-rempli selon profil
//   Champ montant (modifiable pour paiements partiels)

// Étape 2 — Mode de paiement
//   4 cartes 2×2 avec emoji large :
//   [💵 Espèces] [🟡 MTN MoMo] [🟠 Orange Money] [💳 Carte Visa]
//   Si Espèces sélectionné → affiche un select pour choisir le collecteur
//   Si MoMo/Orange → affiche le numéro du membre et un avertissement USSD

// Étape 3 — Récapitulatif
//   Card gris clair avec tous les détails
//   Notice verte : "Un reçu PDF sera généré et envoyé par WhatsApp"
//   Bouton "Confirmer & Enregistrer" en vert primary

// Stepper header :
//   Cercle gris → jaune (actif) → vert avec check (complété)
//   Ligne grise → verte entre les étapes
//   Labels visibles sur desktop, masqués sur mobile (< 640px)
```

#### Tableau des contributions

```typescript
// Header : gradient from-[#0F4A0F] to-[#1A6B1A]
// Tri par colonne avec icône ChevronsUpDown dans le header
// Ligne : hover bg-cem-green-700/4, cursor-pointer
// Actions inline : opacity-0 → group-hover:opacity-100
// Alertes au-dessus du tableau :
//   Jaune si pendingConfirmations > 0 (Clock icon + texte)
//   Rouge si litiges > 0 (AlertTriangle icon + texte)
```

#### Double validation espèces (flux)

```typescript
// Depuis le portail membre → POST /api/contributions/declare
// Collecteur reçoit notification WhatsApp
// Dans son interface → 3 actions :
//   [✅ Confirmer]  → statut CONFIRME, localisation CHEZ_COLLECTEUR
//   [↪ Rediriger]  → modal avec select destinataire (collecteur/trésorier)
//   [❌ Contester]  → modal avec textarea motif obligatoire → statut LITIGE
// Sur CONFIRME → reçu PDF généré automatiquement
// Sur LITIGE   → notification immédiate au Trésorier
```

---

### PHASE 6 · MODULE RUBRIQUES
**Durée estimée : 2 jours**

#### Carte rubrique — micro-interactions

```typescript
// Bande colorée top 6px :
//   URGENT     → from-red-500 to-red-400
//   PRIORITAIRE → from-orange-500 to-amber-400
//   NORMAL     → from-[#1A6B1A] to-[#2D8C2D]

// Badge URGENT : bg-red-500 text-white + .urgence-pulse
// Hover : shadow-cem-lg + -translate-y-1 + border-[#1A6B1A]/30

// Pills montants par profil :
//   Travailleur → bg-[#E8F5E8] text-[#1A6B1A]
//   Étudiant    → bg-blue-50  text-blue-700
//   Couple      → bg-purple-50 text-purple-700
//   Libre       → bg-gray-100 text-gray-500 ("💚 Contribution libre")

// Barre progression :
//   h-2, animée avec shimmer si en cours
//   Couleur selon le taux : vert/jaune/rouge
```

#### Modal création urgente

```typescript
// Bottom sheet sur mobile (slide-up depuis le bas)
// Switch "Rubrique urgente" change le formulaire
// Si urgente actif :
//   Notice rouge : "Notification masse envoyée à tous les membres dès validation"
//   Champ "Personnes concernées" (obligatoire)
//   Montant : "Optionnel — laisser vide = contribution libre (main levée)"
//   Bouton : "🚨 Créer & Notifier tous" en rouge
```

---

### PHASE 7 · MODULES AVANCÉS (GED, PRESTATIONS, STATS)
**Durée estimée : 5 jours**

#### GED Commissions

```typescript
// Interface split-view desktop / tabs mobile
// Zone upload drag & drop :
//   idle    → bordure dashed grise, icône Upload grise
//   hover   → bordure dashed verte, icône verte
//   dragging → bordure verte solide, fond vert léger, scale(1.01)
//   uploading → barre de progression verte
//   success  → check animé (.animate-pop)
// Validation côté client avant upload : format + taille 20Mo
// Paste depuis presse-papier supporté

// Workflow approbation :
//   BROUILLON       → bouton "Soumettre pour approbation"
//   EN_ATTENTE      → boutons "Approuver" / "Rejeter" pour Resp. commission
//   APPROUVÉ        → badge vert, plus de modification possible
//   Rejet           → modal avec champ motif obligatoire
```

#### Prestations de Génie

```typescript
// Fiche prestation avec 3 sections distinctes :
// 1. TARIFICATION (card bleue) :
//    Tarif de base + rabais commanditaire + tarif final
//    Calcul montré en détail : "150 000 F - 60 000 F (−40%) = 90 000 F"
// 2. COURS (card orange) :
//    Liste dépenses avec total en temps réel
//    Justificatif requis si montant > 5 000 FCFA
// 3. ENTRÉES (card verte) :
//    Acompte + solde + total
//    Bouton "Clôturer les entrées" → active le bouton commission

// Bouton "Verser commission" :
//   DÉSACTIVÉ (opacity-50) si statut ≠ ENTREES_COMPLETES
//   ACTIF quand statut = ENTREES_COMPLETES
//   Montre le calcul détaillé : "(90 000 − 17 700) × 35% = 25 305 FCFA"
```

#### Statistiques avec Recharts

```typescript
// BarChart mensuel :
//   Barres normales : fill="#1A6B1A" opacity 0.8
//   Dernier mois (actuel) : fill="#F5C400"
//   Radius : [8,8,0,0]
//   Tooltip personnalisé : bg-white rounded-[12px] shadow-lg border-0

// PieChart modes de paiement (donut) :
//   innerRadius=55 outerRadius=80 paddingAngle=3
//   Couleurs : #F5C400 (MoMo) · #1A6B1A (Espèces) · #F97316 (Orange Money)
//   Label central : total formaté

// Tooltips customisés (tous les graphiques) :
<div className="bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-100 px-4 py-3">
  <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
  <p className="text-sm font-bold text-[#1A6B1A]">{formatAmount(value)}</p>
</div>
```

---

### PHASE 8 · PWA, OFFLINE ET MOBILE
**Durée estimée : 2 jours**

#### Mode hors ligne collecteur

```typescript
// Détecter navigator.onLine → afficher badge "Mode hors ligne"
// Stocker transactions dans IndexedDB si offline :
//   const db = await openDB('sgm-cem-offline', 1)
//   await db.add('pending-contributions', transaction)

// Synchronisation automatique :
window.addEventListener('online', async () => {
  const pending = await db.getAll('pending-contributions')
  for (const tx of pending) {
    await api.post('/contributions', tx)
    await db.delete('pending-contributions', tx.localId)
  }
  // Notifier l'utilisateur : "X contribution(s) synchronisée(s)"
})

// Badge sur les transactions non synchro (icône wifi-off jaune)
```

#### Bottom Navigation mobile

```typescript
// Visible uniquement < 768px (lg:hidden)
// 5 onglets : [🏠 Dashboard] [📋 Rubriques] [💳 Contributions] [🔔 Notifs] [👤 Profil]
// height: 64px + env(safe-area-inset-bottom)
// Onglet actif : icône sur fond cem-green-50 + label vert + indicateur top 2px
// Badge rouge sur Notifications si unreadCount > 0
```

---

## COMPOSANTS RÉUTILISABLES — CODE EXACT

### Button.tsx

```tsx
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'yellow' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean
}

const V: Record<Variant, string> = {
  primary: 'bg-[#1A6B1A] text-white shadow-cem hover:bg-[#0F4A0F] hover:shadow-cem-lg focus:ring-[#1A6B1A]/30',
  yellow:  'bg-[#F5C400] text-[#0F4A0F] font-bold shadow-cem-yellow hover:bg-[#D4A800] focus:ring-[#F5C400]/40',
  outline: 'border-2 border-[#1A6B1A] text-[#1A6B1A] hover:bg-[#1A6B1A] hover:text-white focus:ring-[#1A6B1A]/30',
  ghost:   'text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:ring-gray-200',
  danger:  'bg-[#EF4444] text-white shadow-[0_4px_16px_rgba(239,68,68,0.3)] hover:bg-[#DC2626] focus:ring-red-300',
}
const S: Record<Size, string> = {
  sm:   'gap-1.5 px-3 py-1.5 text-xs rounded-[8px]',
  md:   'gap-2 px-5 py-2.5 text-sm rounded-[10px]',
  lg:   'gap-2 px-6 py-3 text-base rounded-[12px]',
  icon: 'w-9 h-9 rounded-[10px]',
}

export function Button({ variant='primary', size='md', loading, children, className, disabled, ...p }: ButtonProps) {
  return (
    <button {...p} disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold transition-all duration-200',
        'ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-[0.97]',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        'focus:outline-none focus:ring-2 focus:ring-offset-2',
        V[variant], S[size], className
      )}>
      {loading ? <Loader2 size={size==='sm'?12:14} className="animate-spin" /> : null}
      {children}
    </button>
  )
}
```

### StatusBadge.tsx

```tsx
type S = 'EN_OBSERVATION'|'EN_SUIVI'|'FIN_DE_SUIVI'|'DIASPORA'
       | 'CONFIRME'|'EN_ATTENTE_CONFIRMATION'|'LITIGE'|'ANNULE'
       | 'OUVERTE'|'FERMEE'|'ARCHIVEE'|'URGENT'|'PRIORITAIRE'
       | 'ADMIN'|'TRESORIER'|'RESPONSABLE'|'ADJOINT_RESPONSABLE'|'COLLECTEUR'|'MEMBRE'

const STYLE: Record<S,string> = {
  EN_OBSERVATION:          'bg-amber-100   text-amber-800   border-amber-200',
  EN_SUIVI:                'bg-blue-100    text-blue-800    border-blue-200',
  FIN_DE_SUIVI:            'bg-green-100   text-green-800   border-green-200',
  DIASPORA:                'bg-purple-100  text-purple-800  border-purple-200',
  CONFIRME:                'bg-emerald-100 text-emerald-800 border-emerald-200',
  EN_ATTENTE_CONFIRMATION: 'bg-yellow-100  text-yellow-800  border-yellow-200',
  LITIGE:                  'bg-red-100     text-red-700     border-red-200',
  ANNULE:                  'bg-gray-100    text-gray-600    border-gray-200',
  OUVERTE:                 'bg-green-100   text-green-800   border-green-200',
  FERMEE:                  'bg-gray-100    text-gray-600    border-gray-200',
  ARCHIVEE:                'bg-gray-100    text-gray-500    border-gray-200',
  URGENT:                  'bg-red-500     text-white       border-red-500',
  PRIORITAIRE:             'bg-orange-500  text-white       border-orange-500',
  ADMIN:               'bg-violet-600 text-white border-violet-600',
  TRESORIER:           'bg-[#0F4A0F]  text-[#F5C400] border-[#0F4A0F]',
  RESPONSABLE:         'bg-blue-600   text-white border-blue-600',
  ADJOINT_RESPONSABLE: 'bg-sky-500    text-white border-sky-500',
  COLLECTEUR:          'bg-[#F5C400]  text-[#0F4A0F] border-[#D4A800]',
  MEMBRE:              'bg-gray-200   text-gray-700 border-gray-300',
}

const LABEL: Record<S,string> = {
  EN_OBSERVATION:'En Observation', EN_SUIVI:'En Suivi', FIN_DE_SUIVI:'Fin de Suivi',
  DIASPORA:'Diaspora', CONFIRME:'Confirmé', EN_ATTENTE_CONFIRMATION:'En attente',
  LITIGE:'Litige', ANNULE:'Annulé', OUVERTE:'Ouverte', FERMEE:'Fermée', ARCHIVEE:'Archivée',
  URGENT:'🚨 URGENT', PRIORITAIRE:'⚡ PRIORITAIRE',
  ADMIN:'Administrateur', TRESORIER:'Trésorier', RESPONSABLE:'Responsable',
  ADJOINT_RESPONSABLE:'Adjoint Resp.', COLLECTEUR:'Collecteur', MEMBRE:'Membre',
}

export function StatusBadge({ status, dot=true }: { status: S; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${STYLE[status]}`}>
      {dot && !['URGENT','PRIORITAIRE'].includes(status) && (
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 flex-shrink-0" />
      )}
      {LABEL[status]}
    </span>
  )
}
```

### SkeletonCard.tsx

```tsx
export function SkeletonCard() {
  return (
    <div className="bg-white rounded-[18px] border border-gray-100 p-5 overflow-hidden">
      <div className="h-1.5 skeleton rounded-t-[18px] -mt-5 -mx-5 mb-5 w-full" />
      <div className="flex items-center gap-3 mb-4">
        <div className="skeleton w-10 h-10 rounded-[10px] flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-3/4 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
        </div>
        <div className="skeleton h-6 w-16 rounded-full" />
      </div>
      <div className="space-y-2 mb-4">
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-4/5 rounded" />
      </div>
      <div className="flex gap-2 mb-4">
        <div className="skeleton h-6 w-24 rounded-lg" />
        <div className="skeleton h-6 w-20 rounded-lg" />
      </div>
      <div className="skeleton h-2 w-full rounded-full" />
    </div>
  )
}

export function SkeletonTableRow({ cols = 6 }: { cols?: number }) {
  const widths = [32, 24, 16, 20, 16, 12]
  return (
    <tr className="border-b border-gray-50">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`skeleton h-3.5 rounded`}
            style={{ width: `${(widths[i % widths.length]) * 4}px` }} />
        </td>
      ))}
    </tr>
  )
}
```

### EmptyState.tsx

```tsx
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: React.ElementType
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-6 text-center animate-page', className)}>
      <div className="w-20 h-20 bg-gray-100 rounded-[20px] flex items-center justify-center mb-5 animate-float">
        <Icon size={32} className="text-gray-300" />
      </div>
      <h3 className="font-display font-semibold text-gray-700 text-xl mb-2">{title}</h3>
      <p className="text-gray-400 text-sm max-w-xs leading-relaxed mb-6">{description}</p>
      {onAction && actionLabel && (
        <button onClick={onAction}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1A6B1A] text-white text-sm font-semibold rounded-[10px] shadow-cem hover:bg-[#0F4A0F] active:scale-[0.97] transition-all">
          {actionLabel}
        </button>
      )}
    </div>
  )
}
```

### Toast system

```tsx
// src/components/ui/Toast.tsx
// + src/hooks/useToast.ts

// Variantes : success | error | warning | info
// Position : fixed bottom-4 right-4 z-[500]
// Animation entrée : toast-in (slide depuis la droite)
// Barre de progression timeout en bas
// Auto-dismiss après 4s (configurable)
// Stack multiple toasts (max 3 visibles)

type ToastVariant = 'success' | 'error' | 'warning' | 'info'
interface ToastOptions {
  title: string
  message?: string
  variant?: ToastVariant
  duration?: number  // ms, défaut 4000
}

// Utilisation :
// const { toast } = useToast()
// toast({ title: 'Paiement confirmé', message: '3 000 FCFA reçus', variant: 'success' })
// toast({ title: 'Erreur réseau', variant: 'error' })
```

---

## UTILITAIRES CRITIQUES

```typescript
// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

// Formatage montant FCFA — TOUJOURS utiliser cette fonction
export const formatAmount = (amount: number | null | undefined): string => {
  if (amount == null) return '—'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'XAF', maximumFractionDigits: 0
  }).format(amount)
}

// Dates
export const formatDate = (date: string | Date): string =>
  new Date(date).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' })

export const formatDateTime = (date: string | Date): string =>
  new Date(date).toLocaleString('fr-FR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })

export const timeAgo = (date: string | Date): string => {
  const diff = Date.now() - new Date(date).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1)  return 'À l\'instant'
  if (min < 60) return `Il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24)   return `Il y a ${h}h`
  const d = Math.floor(h / 24)
  if (d < 7)    return `Il y a ${d}j`
  return formatDate(date)
}

// Couleur selon ratio de progression
export const progressColor = (ratio: number): string =>
  ratio >= 0.8 ? '#1A6B1A' : ratio >= 0.5 ? '#D97706' : '#DC2626'

export const progressGradient = (ratio: number): string =>
  ratio >= 0.8 ? 'linear-gradient(90deg,#1A6B1A,#2D8C2D)' :
  ratio >= 0.5 ? 'linear-gradient(90deg,#D97706,#F59E0B)' :
                 'linear-gradient(90deg,#DC2626,#EF4444)'

// Initiales depuis un nom complet
export const getInitials = (fullName: string): string =>
  fullName.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase()

// Vérification des permissions
export const canAccess = (userRole: string, requiredRoles: string[]): boolean =>
  requiredRoles.includes(userRole)

export const ROLE_LEVELS: Record<string, number> = {
  ADMIN: 5, TRESORIER: 4, RESPONSABLE: 3,
  ADJOINT_RESPONSABLE: 3, COLLECTEUR: 2, MEMBRE: 1,
}
export const hasMinLevel = (userRole: string, minLevel: number): boolean =>
  (ROLE_LEVELS[userRole] ?? 0) >= minLevel
```

---

## STRUCTURE API BACKEND — MIDDLEWARE RBAC

```typescript
// apps/api/src/middleware/rbac.ts
import type { Request, Response, NextFunction } from 'express'

const ROLE_LEVELS: Record<string, number> = {
  ADMIN: 5, TRESORIER: 4, RESPONSABLE: 3,
  ADJOINT_RESPONSABLE: 3, COLLECTEUR: 2, MEMBRE: 1,
}

export const requireLevel = (minLevel: number) =>
  (req: Request, res: Response, next: NextFunction) => {
    const level = ROLE_LEVELS[req.user?.role ?? ''] ?? 0
    if (level < minLevel) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'Niveau de permission insuffisant' }
      })
    }
    next()
  }

export const requireRole = (...roles: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.user?.role ?? '')) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: `Rôle requis : ${roles.join(' ou ')}` }
      })
    }
    next()
  }

// Appliqué sur TOUTES les routes sensibles :
// router.get('/contributions', authenticate, requireLevel(3), getContributions)
// router.post('/rubriques/urgent', authenticate, requireLevel(3), createUrgentRubrique)
// router.patch('/members/:id/status', authenticate, requireRole('RESPONSABLE','ADJOINT_RESPONSABLE','ADMIN'), changeMemberStatus)
```

---

## FORMAT DES RÉPONSES API

```typescript
// Toutes les réponses suivent ce format uniforme
interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: { code: string; message: string; field?: string; details?: unknown }
  pagination?: { page: number; limit: number; total: number; totalPages: number }
  meta?: Record<string, unknown>
}

// Codes d'erreur standardisés
type ErrorCode =
  | 'VALIDATION_ERROR'      // Zod schema failed
  | 'ACCESS_DENIED'         // RBAC check failed
  | 'NOT_FOUND'             // Resource doesn't exist
  | 'DUPLICATE'             // Unique constraint violated
  | 'BUSINESS_RULE'         // RB-XX violated
  | 'PAYMENT_FAILED'        // MTN/Orange/CinetPay error
  | 'WEBHOOK_INVALID'       // Signature verification failed
  | 'RATE_LIMITED'          // Too many requests
  | 'SERVER_ERROR'          // Unexpected error

// Classe d'erreur personnalisée
class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode = 400,
    public field?: string
  ) { super(message) }
}
```

---

## CHECKLIST COMMIT

Avant chaque commit, vérifie :

- [ ] Couleurs EEC respectées (#0F4A0F, #1A6B1A, #F5C400)
- [ ] Cormorant Garamond sur tous les titres et valeurs numériques
- [ ] Animations présentes (hover, focus, loading, transitions)
- [ ] Skeleton loaders sur tous les fetches
- [ ] États vides gérés avec EmptyState
- [ ] Erreurs gérées avec toast + ErrorBoundary
- [ ] TypeScript strict — zéro `any`
- [ ] RBAC vérifié côté serveur (pas uniquement côté client)
- [ ] Mobile-first — testé mentalement sur 375px
- [ ] formatAmount() utilisé pour TOUS les montants
- [ ] Règles RB-01 à RB-22 respectées
- [ ] AuditLog créé pour les actions sensibles

---

## COMMANDES UTILES

```bash
# Développement
pnpm dev                    # Lance tout en parallèle (Turborepo)

# Base de données
cd apps/api
npx prisma migrate dev --name "init"   # Créer et appliquer migration
npx prisma db seed                     # Seed les données initiales
npx prisma studio                      # Interface graphique BDD

# Génération types
npx prisma generate         # Regénère le client Prisma

# Linting et types
pnpm lint                   # ESLint
pnpm type-check             # tsc --noEmit

# Tests
pnpm test                   # Jest
pnpm test:e2e               # Playwright

# Build production
pnpm build
pnpm start
```

---

## VARIABLES D'ENVIRONNEMENT REQUISES

```bash
# .env (local dev)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sgm_cem"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="dev-secret-change-in-production-min-256-bits"
REFRESH_TOKEN_SECRET="dev-refresh-secret-change-in-production"

# Paiements (sandbox pour développement)
MTN_SUBSCRIPTION_KEY="your-mtn-sandbox-key"
MTN_API_USER="uuid-from-mtn-dashboard"
MTN_API_KEY="your-mtn-api-key"
MTN_ENVIRONMENT="sandbox"
MTN_MOMO_BASE_URL="https://sandbox.momodeveloper.mtn.com"
MTN_WEBHOOK_SECRET="your-webhook-secret"

ORANGE_CLIENT_ID="your-orange-client-id"
ORANGE_CLIENT_SECRET="your-orange-secret"
ORANGE_MERCHANT_KEY="your-merchant-key"

CINETPAY_API_KEY="your-cinetpay-key"
CINETPAY_SITE_ID="your-site-id"

# Notifications
DIALOG360_API_KEY="your-360dialog-key"
TWILIO_ACCOUNT_SID="ACxxxxxxxx"
TWILIO_AUTH_TOKEN="your-auth-token"
TWILIO_FROM="+12345678901"

# Storage
S3_ENDPOINT="https://s3.fr-par.scw.cloud"
S3_ACCESS_KEY="your-access-key"
S3_SECRET_KEY="your-secret-key"
S3_BUCKET="sgm-cem-dev"
S3_REGION="fr-par"

# Web Push
VAPID_PUBLIC_KEY="your-public-vapid-key"
VAPID_PRIVATE_KEY="your-private-vapid-key"
VAPID_EMAIL="dev@cem-melen.cm"

# App
APP_URL="http://localhost:3000"
API_URL="http://localhost:3001"
NODE_ENV="development"
PORT="3001"
```

---

*Prompt Claude Code — SGM-CEM v4.1*
*Culte d'Enfants de Melen · EEC Melen · Yaoundé, Cameroun*
*"La Marche Ensemble dans l'Unité"*


## MODULE FONDS COLLECTEURS - MISE A JOUR v4.2

Nouveau modele FundsTransfer, enums TransferType et FundsTransferStatus, API endpoints /api/funds/transfer avec validation recepteur obligatoire.
