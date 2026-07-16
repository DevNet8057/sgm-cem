# Conventions frontend — Next.js 15 + React 19 (SGM-CEM)

À lire avant tout travail dans `sgm-cem/apps/web`.

## Structure
- `src/app/` — App Router. Les écrans métier vivent surtout dans le dashboard qui rend des vues.
- `src/components/views/` — vues métier (Contributions, Rapports, Journal, Collecteurs…) ; une nouvelle vue = composant ici + entrée dans `src/components/layout/Sidebar.tsx` (avec ses rôles).
- `src/components/ui/` — primitives (Radix UI + antd + Tailwind).
- `src/lib/api.ts` — client axios : baseURL `NEXT_PUBLIC_API_URL`, enveloppe CSRF. **Tout appel réseau passe par lui** — jamais de `fetch`/axios nu vers l'API.
- `src/hooks/` — dont `useSocket` (Socket.IO, temps réel).
- État serveur : **TanStack Query** (clés par domaine, invalidation après mutation). État client : **Zustand**.

## Règles non négociables
1. **`useSearchParams()` TOUJOURS sous `<Suspense>`** — sinon `next build` échoue en prod (jamais visible en dev ; déjà arrivé sur `/payment/return`, pattern de correction visible dans ce fichier).
2. **Réponses API enveloppées** : les données sont dans `res.data.data` (`{ success, data }`). Gérer `success: false` (`error.code`, `error.message`).
3. **Toute vue couvre 4 états** : chargement (skeleton/spinner), vide (message utile), erreur (message actionnable), succès. Textes en **français**.
4. **RBAC visuel cohérent** : les rôles d'une entrée Sidebar doivent correspondre au `requireRole` de l'endpoint. Piège récurrent : oublier `DEVELOPER` là où `ADMIN` passe.
5. **Nouvelle `NEXT_PUBLIC_*`** = triple ajout obligatoire : `apps/web/Dockerfile` (ARG+ENV), `docker-compose.yml` (`build.args`), `.env` racine. Ces variables sont FIGÉES au build Docker.
6. Types partagés avec l'API : `@sgm-cem/shared` — ne pas dupliquer dans `src/types/`.
7. **Animations : jamais `animation-fill-mode: both`/`forwards` avec une `transform` sur un
   conteneur de vue** — la transform animée reste appliquée après l'animation (matrice identité,
   pas `none`) et le conteneur devient le référentiel des `position:fixed` : toutes les modales
   se retrouvent hors écran. Utiliser `backwards` (bug corrigé le 2026-07-16, commit aa90c15).

## Design
- Tailwind 4. Tokens du projet : verts `#052005`/`#0F4A0F`/`#1A6B1A`, jaune `#F5C400`, fond `#F8FAF8`, cartes blanches `rounded-[24px]` border gray-100, boutons `rounded-[10px]`.
- Mobile d'abord : les collecteurs utilisent l'app sur téléphone.
- Icônes lucide-react ; animations framer-motion avec parcimonie ; graphiques Recharts.
