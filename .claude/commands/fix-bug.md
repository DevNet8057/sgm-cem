---
description: Diagnostique puis corrige un bug avec preuve de la cause racine
argument-hint: <description du bug>
---

Bug rapporté : **$ARGUMENTS**

Flux de correction SGM-CEM — **diagnostic d'abord, correctif ensuite** :

1. **Reproduire / localiser** : logs (`docker compose logs api|web` si l'app tourne en Docker), lecture du code, `git log` récent sur les fichiers suspects. Si le bug touche paiements, config ou variables d'environnement : lire `DEPLOIEMENT_DOCKER.md` AVANT toute hypothèse (les pièges connus y sont — deux `.env`, config en base via `getConfig`, webhooks localhost…).
2. **Énoncer la cause racine** en une phrase, avec la preuve (ligne de code, log, valeur de config). Ne jamais corriger un symptôme sans cause démontrée.
3. **Plan minimal** : le lead concerné (`backend-lead` ou `frontend-lead`) valide le correctif le plus petit possible — pas de refactoring opportuniste.
4. **Correctif** par `nano` ; si le bug était silencieux, ajouter le test vitest qui l'aurait attrapé.
5. **Vérification** par `builder` (type-check + tests + `next build` si page touchée), puis test manuel du scénario dans l'app conteneurisée si possible.
6. **Bilan** : cause racine, correctif, comment vérifier, et si le même motif existe ailleurs dans le code (le chercher avec Grep). Commit via l'agent `git` uniquement sur demande.
