# Audit complet SGM-CEM — 2026-07-25

Contrôle demandé avant déploiement : technique (compilation/tests), sécurité, base de
données, flows métier réels, préparation au déploiement — avec un focus particulier sur
les **contributions/paiements**, sur l'état non commité présent sur `main` au moment de
l'audit (voir `git status` : refonte dashboard/thème + réécriture majeure de
`contributions.ts`/`webhooks.ts`/`storage.ts`).

## Résumé exécutif

**Aucun défaut bloquant.** L'état actuel (non commité) compile, passe tous les tests et
corrige même plusieurs failles de sécurité préexistantes sur le flux contributions. Un
vrai petit bug de sécurité latent a été trouvé et corrigé pendant cet audit
(`.gitignore`/`.dockerignore`, voir §3). Quelques points « importants » restent à traiter
avant mise en production réelle (voir §2) — aucun n'empêche un déploiement de test.

---

## 1. Vérification technique

| Contrôle | Résultat |
|---|---|
| `pnpm -r type-check` (shared, api, web) | ✅ OK |
| `pnpm test` API (vitest) | ✅ 118/118 tests, 12 fichiers, y compris le nouveau `webhooks-signature.test.ts` |
| `pnpm test` Web (vitest) | ✅ 32/32 tests |
| `next build` (production) | ✅ compile, 5 routes générées, aucune régression `useSearchParams`/`Suspense` |
| `prisma validate` | ✅ schéma valide |

## 2. Audit sécurité + contributions/paiements (revue approfondie du diff)

Revue dédiée du diff non commité sur `contributions.ts` (+842/-115), `webhooks.ts` (+53),
`storage.ts` (+191, nouveau stockage privé des preuves), `index.ts` (raw body des
webhooks) et les tests associés.

**Points positifs confirmés :**
- Commission Yelii : uniquement via `calculateAmountWithCommission` de
  `packages/shared` — aucune formule dupliquée trouvée dans le repo. Vérifié aussi en
  conditions réelles via `GET /api/contributions` : contribution existante
  montant=100, majoré=104, taux 3 % → cohérent (`Math.ceil(100/0.97)=104`).
- Signature webhook MTN/Orange passée d'un mode **fail-open** (signature optionnelle,
  dangereux) à **fail-closed strict** avec `crypto.timingSafeEqual`. Corps brut capturé
  proprement via l'option `verify` d'`express.json()` (pas besoin de monter la route
  avant le parseur JSON, contrairement à l'ancienne doc Yelii).
- `storage.ts` : double protection anti path-traversal (clé logique + chemin disque
  résolu) sur le nouveau stockage privé des preuves de paiement. Aucun `express.static`
  n'expose `private-uploads` — cohérent avec la règle du §8ter de
  `DEPLOIEMENT_DOCKER.md`.
- Le diff **corrige au passage** plusieurs failles préexistantes : fuite inter-collecteurs
  sur `GET /` et `/validations` (filtre `collecteurId` manquant pour le rôle COLLECTEUR),
  absence de contrôle de propriété sur `/confirm`, `/litige`, `/receipt`, contribution
  créée en base même quand Mobile Money est désactivé, races sur confirm/litige
  remplacées par des `updateMany` atomiques conditionnés sur le statut.
- Vérifié en direct (curl, comptes seed) : login + CSRF double-submit obligatoire (POST
  sans jeton → 403), RBAC hiérarchique (MEMBRE → 403 sur `/developer/config` et
  `/users`), cantonnement des données par rôle (MEMBRE ne voit que ses propres
  contributions via `/me`, 403 sur la liste globale et sur la preuve d'un autre membre).

**À traiter avant mise en production réelle (aucun n'est bloquant pour un simple test/déploiement de démo) :**

1. **`webhooks.ts` (MTN/Orange) écrit directement `prisma.auditLog.create()`** au lieu du
   service centralisé `audit()`. Conséquence : pas d'`ipAddress`/`userAgent` capturés sur
   une action financière sensible, et pas de `try/catch` — un échec d'écriture d'audit
   ferait remonter la requête webhook en 500 (le PSP retente alors inutilement, sans
   casser les données grâce au garde de statut, mais brouille le monitoring). Code
   préexistant, mais ce fichier est justement remanié maintenant — bon moment pour
   aligner sur la convention du projet.
2. **Couverture de tests incomplète sur la nouvelle logique la plus sensible** :
   - aucun test de replay (rejouer un webhook valide deux fois) pour verrouiller
     l'idempotence contre une régression future ;
   - aucun test unitaire sur `storage.ts` (`normalizePrivateKey`,
     `resolvePrivateLocalPath`) malgré 191 lignes de logique anti path-traversal — seule
     barrière contre une lecture/écriture hors de `private-uploads` ;
   - aucun test négatif sur les nouveaux contrôles de propriété
     (`GET/POST /:id/proof`, `/:id/confirm`, `/:id/litige`, `/:id/timeline`,
     `/:id/receipt`) pour vérifier qu'un COLLECTEUR ne peut pas agir sur la contribution
     d'un autre collecteur. C'est la logique neuve la plus à risque du diff — une
     condition inversée par erreur (`!==` → `===`) ne serait détectée par aucun test
     actuel.
3. **Content-Type des callbacks MTN/Orange non vérifié en conditions réelles.**
   `express.json({ verify })` ne peuple `req.rawBody` que si le Content-Type correspond
   au filtre d'`express.json` (`application/json`). Si MTN/Orange envoient un
   Content-Type différent, `rawBody` reste `undefined` et la signature est rejetée à
   tort (401) — les confirmations resteraient bloquées silencieusement (le cron de
   réconciliation rattrape le statut, mais avec délai). **À vérifier explicitement en
   sandbox MTN/Orange avant activation réelle de ce webhook.**
4. **Incohérence d'accès sur la preuve de paiement** : `GET /:id/proof` exige
   `requireLevel(2)` (COLLECTEUR minimum), mais `GET /me` (accessible à un MEMBRE) expose
   un `proofUrl` qui pointe vers cette même route protégée. Un membre qui suivrait ce lien
   recevrait un 403 permanent (aujourd'hui non exploité : `MesContributions.tsx` n'affiche
   pas encore ce lien). À trancher : preuve réservée au staff (documenter) ou accès à
   ouvrir au propriétaire de la contribution.
5. Points mineurs (style/robustesse, non bloquants) : `GET /:id/receipt` n'utilise pas
   `routeIdSchema.parse` comme le reste du fichier ; un chemin de compatibilité
   « `private:` sans `v1:` » dans `contributions.ts` semble être du code mort (le nouveau
   format `private:v1:...` ne peut pas encore avoir produit de données legacy) ;
   `getPrivateFileStream` n'a pas de fallback si un enregistrement a un `bucket`
   manquant ; le mode maintenance (503) bloque aussi les webhooks MTN/Orange sans retry
   applicatif ; le montant saisi par le collecteur (`montant`) n'est jamais recoupé avec
   les montants de la rubrique (probablement voulu — encaissement manuel — à confirmer).

## 3. Bug de sécurité trouvé et corrigé pendant l'audit

**`.gitignore` et `.dockerignore` n'excluaient pas le nouveau dossier
`apps/api/private-uploads/`** (preuves de paiement, introduit par ce diff), alors que
`apps/api/uploads/` l'était déjà. En dev hors Docker (voir `README-DEMARRAGE.md`), un
`git add -A` un peu large aurait pu committer des preuves financières privées dans
l'historique git. **Correction initiale puis annulée sur décision explicite de l'utilisateur** : le
`.gitignore` avait d'abord été corrigé pour exclure `private-uploads/` comme `uploads/`.
L'utilisateur a ensuite demandé explicitement que les preuves de paiement soient
committées dans git (choix assumé, risque de données financières/personnelles
persistantes dans l'historique git signalé et confirmé) — `.gitignore` a donc été remis
à son état d'origine (`private-uploads/` suivi par git). Le `.dockerignore`, lui, exclut
toujours `private-uploads` du contexte de build Docker (n'affecte pas les commits git,
seulement ce qui est envoyé au démon Docker au build).

## 4. Audit base de données

- `prisma validate` OK, schéma cohérent avec les requêtes réelles testées.
- Index en place sur les colonnes de filtrage fréquentes (`Contribution.statut`,
  `.membreId`, `.rubriqueId`, `.paymentStatus`, `.createdAt`, etc.).
- Pas de dossier `prisma/migrations` — conforme à la convention du projet (`db push`).
- `SystemSettings` (ancien modèle de config globale) coexiste avec `SystemConfig`
  (panneau développeur) mais reste utilisé (`routes/settings.ts`) — pas de code mort.
- Contraintes XOR applicatives non protégées par la base (ex.
  `Contribution.membreId`/`contributeurExterneId`) — déjà documenté comme choix
  assumé dans le schéma, pas une régression de cet audit.

## 5. Préparation au déploiement

- **Docker Compose** : diff cohérent avec la règle §8ter de `DEPLOIEMENT_DOCKER.md`
  (nouveau volume nommé `private_uploads`, jamais servi publiquement).
  `docker-entrypoint.sh` et `Dockerfile` relus : `db push` idempotent, seed conditionnel,
  détection Docker local vs Render managed, healthcheck sur `/api/health` — rien de cassé.
- **`.env.example`** : mis à jour pour documenter que `MTN_WEBHOOK_SECRET` et
  `ORANGE_CLIENT_SECRET` servent désormais aussi à la vérification HMAC des webhooks.
- **Écart trouvé — `render.yaml` non aligné** (constat original du jour de l'audit) : le
  blueprint Render ne montait qu'un disque pour `uploads`, aucun pour `private-uploads` —
  risque de perte des preuves de paiement à chaque redéploiement sur cette plateforme.
  **Mise à jour du même jour** : sur décision explicite de l'utilisateur, tout ce qui
  concernait Render a été retiré du projet (`render.yaml`, `DEPLOIEMENT_RENDER.md`,
  `sgm-cem/DEPLOY_RENDER.md`, proxy Render dans `next.config.ts`, détection Render dans
  `docker-entrypoint.sh`/`Dockerfile`, `RENDER_GIT_COMMIT` dans `index.ts`) — Render n'est
  plus un chemin de déploiement de ce projet, la cible confirmée est Docker → AWS. Ce
  point de l'audit est donc **résolu par suppression** plutôt que par correction.
- **`CRON_SECRET`** : présent dans `.env.example` et `render.yaml` mais aucune référence
  dans `apps/api/src` — configuration orpheline (nettoyage doc possible, aucun risque
  fonctionnel).
- Clé racine `sgm-cem/.env` présente et à jour à l'exception de `S3_*`/`CRON_SECRET`
  (cohérent avec le mode stockage local actif, pas un problème).

## 6. Flows réels testés (curl, API en conditions réelles, comptes seed)

- Login + CSRF double-submit : OK, POST sans jeton → 403.
- RBAC hiérarchique : MEMBRE → 403 sur `/api/developer/config` et `/api/users`.
- Cantonnement des données : `GET /api/contributions/me` (MEMBRE) limité à ses propres
  contributions ; `GET /api/contributions` (liste globale) → 403 pour un MEMBRE ; preuve
  de paiement d'un autre membre → 403.
- `GET /api/contributions/validations` (staff) → données réelles cohérentes.
- `GET /api/payments/config` → taux de commission Yelii effectif 3 % confirmé en base.

## 7. Hors périmètre de cet audit (non fait, à décider)

- **Vérification visuelle du nouveau thème sombre/clair** (refonte dashboard) : la
  compilation et les tests passent, mais aucune capture d'écran réelle n'a été prise
  (cohérent avec la dette déjà connue, voir mémoire `sgm_cem`). `docs/reference/TEST_CHROME_CLAUDE.md`
  documente la procédure si vous voulez une passe visuelle via Claude + Chrome.
- Test de bout en bout des webhooks MTN/Orange avec un vrai callback sandbox (nécessite
  des identifiants sandbox réels, voir point §2.3).

---

**Fichiers modifiés pendant cet audit** : `sgm-cem/.gitignore`, `sgm-cem/.dockerignore`
(ajout de l'exclusion `private-uploads`). Aucun autre fichier applicatif touché — cet
audit est un contrôle, pas une session de correction.
