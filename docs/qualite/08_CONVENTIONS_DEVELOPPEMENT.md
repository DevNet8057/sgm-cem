# Conventions de développement et définition de « terminé » — SGM-CEM

| Élément | Valeur |
|---|---|
| Version | 1.0 — 17/10/2026 |
| Complète | `CLAUDE.md`, `.claude/instructions/*` (conventions existantes, toujours valables sauf contradiction explicite ci-dessous) |

---

## 1. Flux Git
- `main` est protégée : PR obligatoire, CI verte, 1 revue (2 pour une PR touchant l'argent, l'authentification ou les données personnelles), historique linéaire.
- Branches : `feat/…`, `fix/…`, `sec/…`, `chore/…`, `docs/…`.
- Commits conventionnels en français, comme dans l'historique existant : `feat(paiements): …`, `fix(fonds): …`, `sec(auth): …`.
- Versions SemVer taguées `vX.Y.Z` ; `CHANGELOG.md` maintenu (section « Sécurité » obligatoire si concernée).
- Aucun secret, dump de base ni fichier `.env` commité (gitleaks bloquant).

## 2. Règles de code — API
1. **Une route = mince** : validation Zod de l'entrée → appel d'un cas d'usage → réponse typée. Pas de logique métier dans la route.
2. **Autorisation** : `policy.can(actor, action, resource)` et `scope(actor)` pour toute lecture ou écriture métier. `requireLevel` ne sert plus que de garde grossière.
3. **Transitions** : toujours conditionnelles (`updateMany … WHERE statut = attendu` ou colonne `version`) ; vérifier `count` et renvoyer 409 en cas de conflit.
4. **Transaction** : mutation + audit + outbox (notifications, PDF) dans la **même** transaction. Les appels aux prestataires et les envois se font **hors** transaction, depuis le worker.
5. **Audit** : uniquement via `audit()` du module `platform`, avec l'auteur réel (y compris sous impersonation). Jamais `prisma.auditLog.create` en direct.
6. **Erreurs** : `AppError(code, message, status)` ; codes en `SCREAMING_SNAKE_CASE` ; messages en français, accentués, compréhensibles par l'utilisateur ; aucun détail technique.
7. **Prisma** : un seul client (`getPrisma()`) ; jamais `new PrismaClient()` dans un module ; `$queryRaw` paramétré uniquement.
8. **Configuration** : `getConfig()` pour toute valeur métier ou d'intégration (règle d'or n° 1 de `CLAUDE.md`). Les secrets d'infrastructure ne passent que par `lib/security`.
9. **Montants** : entiers XAF ; calculs dans `packages/shared` uniquement ; jamais de `parseFloat` sur un montant.
10. **Dates** : stockage en UTC ; affichage `Africa/Douala` ; pas de `new Date(year, month)` sans fuseau explicite dans les traitements périodiques.
11. **Journaux** : `logger` (pino) avec `requestId` ; jamais `console.*` ; jamais de secret ni de numéro complet.
12. **HTML généré** : moteur de modèles à échappement automatique ; aucune interpolation brute.

## 3. Règles de code — Web
1. **Une route par écran** ; état d'URL (`searchParams`) pour les filtres, onglets et pages ; `useSearchParams()` sous `<Suspense>` (règle n° 7 de `CLAUDE.md`).
2. **Données serveur** dans TanStack Query uniquement ; Zustand réservé à l'état d'interface (tiroir, préférences).
3. **Composants** : antd v6 pour les composants interactifs, Tailwind pour la mise en page. **Interdits** : nouveaux composants maison qui doublonnent antd, sélecteurs `.ant-*`, `!important`, couleurs hexadécimales en dur (utiliser les jetons).
4. **Capacités** : afficher ou masquer les actions selon `resource.actions` renvoyé par l'API, jamais selon le rôle seul.
5. **Mobile-first** : concevoir à 360 px d'abord ; cibles ≥ 44 px ; champs ≥ 16 px ; `inputMode` et `autoComplete` corrects ; action principale fixée en bas avec la safe-area ; détails en feuille inférieure.
6. **Accessibilité** : `Form.Item` avec `label` (ou `aria-label`) ; focus géré dans les feuilles ; `aria-live` pour les retours d'action ; pas de `maximumScale`.
7. **Performance** : `next/dynamic` pour les bibliothèques lourdes (graphiques, Excel) ; `next/image` ; aucune nouvelle dépendance de plus de 30 kB compressés sans justification dans la PR.
8. **Textes** : français correct et accentué ; vocabulaire unique (glossaire du doc 01 § 2) ; montants au format `12 100 FCFA`.

## 4. Base de données
- Toute modification du schéma passe par une **migration** générée (`prisma migrate dev`), relue en PR, de type **expand/contract**.
- Interdits en production : `db push`, migrations destructives dans la même version que le code qui cesse d'utiliser la donnée, modifications manuelles hors script relu.
- Toute nouvelle table financière est en ajout seul (pas d'UPDATE ni de DELETE métier).

## 5. Décisions d'architecture (ADR)
Toute décision qui modifie un principe du doc 02 (§ 5.1), le modèle de données financier, la sécurité ou une dépendance majeure donne lieu à un ADR : `docs/adr/NNN-titre.md`, avec contexte, options, décision, conséquences et statut. Il est approuvé en PR par le Responsable technique.

## 6. Définition de « terminé » (DoD)
Une exigence (EF-…) est **terminée** si :
1. le code est fusionné sur `main` et la CI est verte (lint, types, tests, audit, build, budgets) ;
2. les tests couvrent le cas nominal, les erreurs, les droits (matrice RBAC) et la concurrence si l'exigence est financière ;
3. les critères d'acceptation du doc 01 sont démontrés (test automatisé ou procès-verbal de recette) ;
4. l'audit et les notifications sont en place si l'action est sensible ;
5. l'écran est conforme au § 3 (vérifié par Playwright mobile et axe) ;
6. la documentation est à jour : statut dans le doc 01, ADR si nécessaire, runbook si une procédure change ;
7. la migration de schéma, s'il y en a une, est relue et testée sur une copie de la préproduction.

## 7. Modèle de description de PR (`.github/pull_request_template.md`)
```markdown
## Objet
Exigences : EF-… / RG-… / V-… / UX-…

## Changements
- …

## Risques et retour arrière
- Migration : aucune | additive | (contract → justifier)
- Retour arrière : …

## Vérifications
- [ ] Tests (unitaires, intégration, RBAC, concurrence)
- [ ] Playwright mobile + axe (si web)
- [ ] Audit, notifications (si action sensible)
- [ ] Docs mises à jour (01 / 02 / 05)
```

*Fin des conventions.*
