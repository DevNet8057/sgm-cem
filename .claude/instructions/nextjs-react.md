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

Deux systèmes de design coexistent, ne pas les mélanger :

- **Pages publiques** (login, `providers.tsx` → `lightTheme`) : Tailwind 4, tokens verts `#052005`/`#0F4A0F`/`#1A6B1A`, jaune `#F5C400`, fond `#F8FAF8`, cartes blanches `rounded-[24px]` border gray-100, boutons `rounded-[10px]`.
- **Espace authentifié** (`(app)/layout.tsx`, refonte SaaS fintech premium façon Stripe/Linear/Mercury, 2026-07-23) : tokens `dash-*` (`bg-dash-bg`, `bg-dash-card`, `text-dash-text`, `border-dash-border`, `shadow-dash`…), `rounded-dash-card` (20px) / `rounded-dash-btn` (14px) / `rounded-dash-table` (18px) / `rounded-dash-pill` (999px). **Sombre par défaut + bascule clair** disponible (bouton Sun/Moon dans `TopBar.tsx`, visible à toutes les tailles d'écran).
  - Mécanisme : tous les tokens `colors.dash.*` de `tailwind.config.ts` pointent vers des variables CSS RGB (`rgb(var(--dash-x-rgb) / <alpha-value>)`) définies dans `globals.css` sous `.dash-scope, body.premium-app { ... }` (valeurs sombres) et surchargées sous `[data-theme="light"]` (valeurs claires). **Ne jamais réintroduire une couleur hex/rgba littérale dans un composant de l'espace authentifié** (gradients Recharts, `boxShadow` inline, etc.) — toujours passer par `var(--dash-*)` ou une classe `dash-*`, sinon l'élément reste figé dans un seul thème (piège déjà rencontré : `ActivityCard.tsx`, `Sidebar.tsx`, badges `.ant-tag-*` de `globals.css`).
  - État du toggle : store Zustand persisté `useThemeStore` (`src/store/themeStore.ts`, `theme: 'dark'|'light'`, défaut `'dark'`). `DashboardThemeProvider.tsx` choisit `dashboardTheme`/`dashboardThemeLight` (AntD, `src/lib/antd-theme.ts`) et pose `data-theme` sur `document.body` + sur son wrapper `<App>`.
  - Dette connue (non couverte par le lot initial) : `Modal.tsx`, `EmptyState.tsx`, `Button.tsx`, `Input.tsx`, `PasswordInput.tsx`, `SearchableSelect.tsx` (labels `text-slate-300/400`, options `text-white`), `StatusBadge.tsx` (`TONE_CLASS` en rgba/hex littéraux, indépendant des règles `.badge-*`/`.ant-tag-*` déjà corrigées dans `globals.css`), `Ged.tsx`, `ChangePassword.tsx` gardent des hex/gris Tailwind sombres en dur — resteront visuellement sombres (ou peu lisibles) même en mode clair tant qu'ils n'auront pas été migrés vers les tokens `dash-*`. Vérifié non bloquant : `tsc --noEmit` passe sur `apps/web` ET `apps/api` avec ces fichiers en l'état (aucune erreur de compilation, juste une dette visuelle).
- Mobile d'abord : les collecteurs utilisent l'app sur téléphone — toute nouvelle icône/action de la TopBar doit rester accessible en dessous du breakpoint `sm` (piège déjà rencontré avec le toggle thème, initialement masqué sur mobile).
- Icônes lucide-react ; animations framer-motion avec parcimonie ; graphiques Recharts.
