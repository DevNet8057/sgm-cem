# SGM-CEM — Système de Gestion des Membres, Culte d'Enfants de Melen (EEC Yaoundé)

Application de gestion de contributions financières d'une communauté religieuse au Cameroun :
membres, rubriques, collectes Mobile Money (Yelii : MTN MoMo + Orange Money, CinetPay),
commissions collecteurs, trésorerie, rapports PDF/Excel, notifications (push web, email, WhatsApp/SMS).

## 📖 Lectures OBLIGATOIRES avant d'agir

1. **`DEPLOIEMENT_DOCKER.md`** (racine) — TOUJOURS le lire pour toute tâche touchant au
   déploiement, aux `.env`, à Docker, à Prisma ou à la configuration. Il recense les
   8 pièges spécifiques de ce projet (deux `.env`, pas de migrations, config en base…).
2. `.claude/instructions/` — conventions par domaine (à lire selon la tâche) :
   - `express-prisma.md` → tout travail backend
   - `nextjs-react.md` → tout travail frontend
   - `database.md` → tout travail schéma/données
   - `api-design.md` → tout nouvel endpoint ou contrat API

## Stack (réelle — ne pas supposer autre chose)

- **Monorepo pnpm** : `sgm-cem/` → `apps/api`, `apps/web`, `packages/shared`
- **Backend** : Express 4 + TypeScript, Prisma 5 (PostgreSQL 15), Redis 7 + BullMQ,
  Socket.IO, Puppeteer (PDF), Zod, JWT + CSRF (csrf-csrf)
- **Frontend** : Next.js 15 (App Router) + React 19, Tailwind 4, Radix UI + antd,
  TanStack Query, Zustand, framer-motion, Recharts
- **Déploiement** : Docker Compose (4 services), voir `DEPLOIEMENT_DOCKER.md`
- Langue du produit et des messages : **français**

## 👥 Équipe d'agents (`.claude/agents/`)

Pour toute tâche non triviale, travailler comme une équipe — l'**architect** orchestre :

| Agent | Rôle |
|---|---|
| `architect` | Décompose la demande, délègue aux leads, assemble, tranche les arbitrages |
| `backend-lead` | Planifie les tâches Express/Prisma (routes, services, schéma, webhooks) |
| `frontend-lead` | Planifie les tâches Next.js 15 (pages, vues, composants, état) |
| `nano` | Écrit le code — un fichier à la fois, en suivant le plan d'un lead |
| `builder` | Vérifie que ça compile : `pnpm type-check`, `next build`, tests vitest |
| `reviewer` | Relit le code selon les conventions SGM-CEM (`.claude/instructions/`) |
| `git` | Branches, commits conventionnels français, propreté de l'historique |

Commandes : `/add-feature`, `/add-page`, `/add-api`, `/fix-bug` (voir `.claude/commands/`).
Des hooks (`.claude/hooks/`) lancent automatiquement type-check et ESLint après chaque écriture.

## Règles d'or du projet

1. **Config métier via `getConfig()`** (jamais `process.env.X` direct dans le code métier) —
   la table `system_configs` est la source de vérité, `.env` n'est qu'un fallback.
2. **Toute action sensible passe par `audit()`** (journal « qui a fait quoi »).
3. Réponses API : `{ success: true, data }` / `{ success: false, error: { code, message } }` —
   erreurs via `AppError(code, message, status)`.
4. RBAC : rôles `DEVELOPER > ADMIN > TRESORIER > RESPONSABLE > ADJOINT_RESPONSABLE > COLLECTEUR > MEMBRE`.
5. Prisma : **`db push`**, pas de migrations. Seeds idempotents (upsert).
6. Nouvelle variable d'environnement → `.env` **racine** (Docker) + `.env.example` + `seed-config.ts` si gérable depuis le panneau développeur.
7. Pages Next.js : `useSearchParams()` toujours sous `<Suspense>` (casse `next build` sinon).
8. Messages utilisateur en français ; code commenté sobrement en français.
9. Ne jamais exécuter `docker compose down -v` (détruit les données) sans accord explicite.

Documentation complémentaire (index : `docs/README.md`) :
- `docs/reference/` — guides vivants : `GUIDE_SGM_CEM.md`, `PAYMENT_FLOWS_SGM_CEM.md`,
  `DEVELOPER_PANEL_SGM_CEM.md` (cité par le code via ses `§`), `TEST_PLAN.md`
- `docs/archives/` — rapports de chantiers terminés
- `sgm-cem/CLAUDE_SGM_CEM.md` — conventions historiques détaillées
