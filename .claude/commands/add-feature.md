---
description: Crée une fonctionnalité complète de A à Z (api + web) via l'équipe d'agents
argument-hint: <description de la fonctionnalité>
---

Fonctionnalité demandée : **$ARGUMENTS**

Exécute le flux complet de l'équipe SGM-CEM (voir `CLAUDE.md`) :

1. **Cadrage** — lance l'agent `architect` avec la demande. Il doit :
   - lire le code existant concerné et `DEPLOIEMENT_DOCKER.md` si la config/le déploiement sont touchés ;
   - définir d'abord le **contrat API** (endpoints, formes `{ success, data }`, rôles autorisés) ;
   - poser à l'utilisateur (AskUserQuestion) uniquement les questions produit indispensables.
2. **Plans** — l'architect délègue à `backend-lead` et `frontend-lead` qui rendent chacun un plan fichier-par-fichier.
3. **Implémentation** — pour chaque fichier du plan, un agent `nano` avec le plan du lead en contexte. Types communs d'abord (`packages/shared`), puis api, puis web.
4. **Vérification** — agent `builder` : `pnpm build:shared`, type-check api+web, `pnpm --filter web build` si une page a changé, tests vitest concernés.
5. **Relecture** — agent `reviewer` sur le diff complet ; corriger les constats bloquants (retour à nano) et re-vérifier.
6. **Bilan** — résumé en français : fichiers créés/modifiés, comment tester à la main dans l'app (http://localhost:3000), points restants. Proposer le commit (agent `git`) mais ne committer que si l'utilisateur le demande.
