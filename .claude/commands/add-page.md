---
description: Crée une page/vue Next.js 15 complète (route, vue, données, RBAC, états UI)
argument-hint: <nom et rôle de la page>
---

Page demandée : **$ARGUMENTS**

Flux frontend SGM-CEM :

1. Lance `frontend-lead` pour le plan. Il doit préciser :
   - route App Router (`apps/web/src/app/...`) ou vue dashboard (`src/components/views/` + entrée Sidebar) — la plupart des écrans métier sont des vues dashboard ;
   - endpoints consommés (vérifier qu'ils EXISTENT dans `apps/api/src/routes/` — sinon basculer sur `/add-api` d'abord) ;
   - rôles autorisés (cohérence Sidebar ↔ middleware api) ;
   - états chargement / vide / erreur / succès, textes en français ;
   - design tokens du projet (verts `#0F4A0F`/`#1A6B1A`, jaune `#F5C400`, `rounded-[10px]`), responsive mobile.
2. Implémentation par `nano`, un fichier à la fois.
3. `builder` : type-check web **et `pnpm --filter web build`** (obligatoire pour une page — attrape les erreurs de prérendu type `useSearchParams` sans `<Suspense>`).
4. `reviewer` sur le diff, corrections éventuelles, puis bilan avec la marche à suivre pour voir la page dans l'app.
