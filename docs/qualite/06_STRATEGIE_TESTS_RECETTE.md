# Stratégie de tests et de recette — SGM-CEM

| Élément | Valeur |
|---|---|
| Version | 1.0 — 17/10/2026 |
| État de départ (mesuré) | API : 133 tests (120 passent sur une base seedée ; la CI ne peut pas passer sans seed) ; web : 23 tests ; aucune mesure de couverture (outil absent) ; aucun E2E ; aucun test d'accessibilité |
| Objectif | Toute exigence **M** du doc 01 couverte par au moins un test automatisé ; parcours P1 à P6 en E2E mobile ; CI bloquante |

---

## 1. Pyramide cible

| Niveau | Outil | Portée | Volume cible | Exécution |
|---|---|---|---|---|
| Unitaires (domaine) | Vitest 5 | Règles pures : RG-03 à RG-09, transitions d'état, `policy.can()`, calculs partagés | Plus de 300, en moins de 10 s | Chaque commit |
| Intégration API | Vitest 5 + Supertest + **PostgreSQL éphémère** (Testcontainers ou service CI) + prestataires simulés (MSW) | Routes, transactions, concurrence, webhooks, RBAC par enregistrement | Plus de 250, en moins de 3 min | Chaque PR |
| Contrat | Schémas Zod → OpenAPI ; tests de compatibilité du client web | Rupture de contrat | Automatique | Chaque PR |
| Composants web | Vitest + Testing Library | Formulaires, steppers, états vides et d'erreur | Plus de 80 | Chaque PR |
| E2E mobile | Playwright 1.64, profils 360×800 (Android) et 390×844 (iPhone) | Parcours P1 à P6, retour navigateur, rafraîchissement, hors ligne | 25 à 40 scénarios | Chaque PR (fumée) ; complet chaque nuit |
| Accessibilité | `@axe-core/playwright` | Toutes les routes | 0 violation « serious » ou « critical » | Chaque PR |
| Performance | Lighthouse CI (mobile, 3G simulée) | Connexion, accueil membre, payer, collecte publique | Budgets ENF-01 | Chaque PR (fumée) |
| Sécurité | Semgrep, gitleaks, `pnpm audit`, Trivy, ZAP baseline | Code, dépendances, images, préproduction | 0 critique ou élevée | PR et version |
| Charge | k6 | 50 puis 200 utilisateurs virtuels ; paiements simulés | p95 ≤ 800 ms | Avant version majeure |
| Recette métier | Fiches manuelles + appareils réels | Parcours P1 à P6, rapports | 100 % des exigences M de la version | Chaque version |

## 2. Principes d'ingénierie de test
1. **Isolation** : chaque fichier de test d'intégration dispose d'une base propre (schéma par worker ou transaction annulée). La configuration actuelle `isolate:false`, qui partage la base de développement, est **interdite** (doc d'architecture § 3.6).
2. **Données de test** : fabriques (`buildMembre()`, `buildRubrique()`…) et seed de test dédié, sans dépendance au seed de démonstration ni au `.env` du développeur.
3. **Prestataires simulés** : Yelii, CinetPay, 360dialog, Twilio et SMTP simulés au niveau HTTP (MSW). **Aucun appel réel en CI.** Un test « canari » optionnel vise les bacs à sable, avec des clés de sandbox stockées en secrets CI.
4. **Pas de rate-limit en test** (store en mémoire réinitialisé) ; des tests **dédiés** vérifient le limiteur.
5. **Horloge contrôlée** (`vi.useFakeTimers`) pour les expirations (OTP, brouillons, autorisations, rétention).
6. **Concurrence testée** : `Promise.all` de requêtes concurrentes pour toute transition financière.
7. **Couverture** : `@vitest/coverage-v8` ; seuils bloquants de 80 % pour `modules/{contributions,payments,treasury,refunds}` et `shared/policy`, et de 60 % au global.

## 3. Matrice RBAC (générée)

Un test paramétré parcourt **rôle × action × périmètre** à partir d'une table unique, identique à celle du doc 01 § 4 :

```ts
// tests/rbac.matrix.test.ts (extrait de principe)
const cases = [
  { role: 'COLLECTEUR', action: 'contribution.confirm', resource: momoPendingOwn,   expect: 403 }, // RG-13
  { role: 'COLLECTEUR', action: 'contribution.confirm', resource: cashPendingOther, expect: 404 }, // hors périmètre
  { role: 'COLLECTEUR', action: 'contribution.confirm', resource: cashPendingOwn,   expect: 200 },
  { role: 'TRESORIER',  action: 'contribution.confirm', resource: cashPendingOther, expect: 403 }, // sans autorisation
  { role: 'TRESORIER',  action: 'contribution.confirm', resource: cashPendingOtherAuthorized, expect: 200 },
  { role: 'COLLECTEUR', action: 'funds.claim',          resource: transferToTreasurer, expect: 404 }, // route supprimée
  { role: 'MEMBRE',     action: 'ged.download',         resource: draftDocument,    expect: 403 },
  // … une ligne par case de la matrice
]
```
Chaque ligne de la matrice du doc 01 a son cas. **Un ajout de route sans cas dans la matrice fait échouer la CI** (test qui énumère les routes Express).

## 4. Scénarios obligatoires par domaine (extraits normatifs)

### 4.1 Authentification
| ID | Scénario | Attendu |
|---|---|---|
| T-AUTH-01 | Connexion valide puis appel d'une route protégée | 200 |
| T-AUTH-02 | `mustChangePassword` vrai : appel d'une route autre que `change-password` | 403 `PASSWORD_CHANGE_REQUIRED` |
| T-AUTH-03 | Compte désactivé : rafraîchissement | 401, sessions supprimées (rejeu de la preuve P5) |
| T-AUTH-04 | Rejeu d'un jeton de rafraîchissement déjà utilisé | 401 + révocation de la famille |
| T-AUTH-05 | OTP : 4e essai, OTP expiré, OTP d'un autre usage | 401 |
| T-AUTH-06 | « Mot de passe oublié » : réponse identique pour un compte existant, un compte inexistant et un compte ADMIN | Corps et durée équivalents |
| T-AUTH-07 | Démarrage en production sans `CSRF_SECRET` | Le processus refuse de démarrer |

### 4.2 Paiements
| ID | Scénario | Attendu |
|---|---|---|
| T-PAY-01 | MoMo simple : initiation → webhook succès avec le bon montant | `CONFIRMEE`, 1 reçu, 1 notification |
| T-PAY-02 | Webhook reçu deux fois, et webhook + polling simultanés | Un seul effet (RG-12) |
| T-PAY-03 | Montant rapporté ≠ attendu | Pas de confirmation, 1 alerte (persistante, dédupliquée) |
| T-PAY-04 | **Lot de 2 à 3 rubriques**, montant = total du lot | **Toutes** les lignes `CONFIRMEE`, lot `CONFIRME` (rejeu de la preuve P1) |
| T-PAY-05 | Délai dépassé à l'initiation | `A_VERIFIER` avec clé d'idempotence ; la réconciliation retrouve et confirme |
| T-PAY-06 | Double clic sur une collecte publique (deux requêtes concurrentes, même brouillon) | 1 contribution, 1 appel au prestataire |
| T-PAY-07 | Signature invalide, horodatage expiré, corps altéré | 401, aucun effet |
| T-PAY-08 | CinetPay : devise ≠ XAF | Pas de confirmation |
| T-PAY-09 | Statut prestataire `unknown` (5xx, délai) | Aucun changement d'état |
| T-PAY-10 | Confirmation manuelle d'un paiement MoMo par un collecteur, un responsable ou un admin | 403 (rejeu de la preuve P4) |

### 4.3 Validation, litiges, trésorerie
| ID | Scénario | Attendu |
|---|---|---|
| T-VAL-01 | Deux confirmations concurrentes d'une déclaration | 1 succès + 409 ; 1 reçu |
| T-VAL-02 | Refus avec motif de moins de 10 caractères | 400 |
| T-VAL-03 | Litige ouvert par un collecteur | 403 |
| T-VAL-04 | Litige sur des fonds déjà transférés | 409 `FUNDS_ALREADY_MOVED` |
| T-FND-01 | Deux transferts concurrents des mêmes contributions | 1 succès, 1 échec ; Σ cohérente |
| T-FND-02 | Confirmer et annuler un transfert simultanément | Un seul état terminal |
| T-FND-03 | Réception par un non-destinataire (ancien `/claim`) | 404 (rejeu de la preuve P3) |
| T-FND-04 | Dépôt bancaire de contributions non `REMIS_TRESORIER`/`EN_CAISSE` | 409 |
| T-FND-05 | Contrôle d'invariant après chaque test de trésorerie : Σ localisations = total confirmé | Vrai |

### 4.4 Sécurité applicative
| ID | Scénario | Attendu |
|---|---|---|
| T-SEC-01 | Nom de donateur `<img src=…>` → reçu HTML | Balise échappée ; aucune requête réseau pendant le rendu (rejeu de la preuve P2) |
| T-SEC-02 | Téléversement d'un fichier HTML renommé en `.pdf` (type MIME falsifié) | 415 |
| T-SEC-03 | Mutation sans en-tête CSRF | 403 `CSRF_INVALID` |
| T-SEC-04 | Accès à un document GED brouillon par un membre | 403 ou 404 |
| T-SEC-05 | En-têtes de sécurité sur `/` et `/api/health` | Présents |

### 4.5 E2E mobile (Playwright)
| ID | Scénario | Attendu |
|---|---|---|
| T-E2E-01 | P1 : le membre paie en MoMo (prestataire simulé) | ≤ 6 touchers ; reçu affiché ; accueil mis à jour |
| T-E2E-02 | P2 + P3 : déclaration d'espèces puis confirmation par le collecteur via la notification | Cible ouverte par URL ; statut final `CONFIRMEE` |
| T-E2E-03 | P4 : remise des fonds au trésorier puis réception | Bordereau disponible |
| T-E2E-04 | P6 : collecte publique (titre visible, urgence, brouillon repris après fermeture de l'onglet) | Don confirmé |
| T-E2E-05 | Bouton retour du navigateur après 3 navigations | Revient aux écrans précédents ; ne quitte pas l'application |
| T-E2E-06 | Rafraîchissement sur une vue profonde | Même vue |
| T-E2E-07 | Hors ligne : encaissement mis en file, retour du réseau, rejeu en double | 1 seule contribution créée |
| T-E2E-08 | Mesures automatiques : 0 débordement horizontal ; 0 cible d'action principale < 44 px ; 0 champ sans libellé ; champs ≥ 16 px | Vrai sur toutes les routes |

Les scripts d'audit mobile produits lors de l'audit (`run/mobile-audit.js`, `run/mobile-flows.js`) servent de base aux assertions de T-E2E-08.

## 5. Recette en bac à sable des prestataires (avant chaque version touchant aux paiements)

| ID | Cas (sandbox Yelii et CinetPay) | Attendu | Résultat | Signature |
|---|---|---|---|---|
| R-01 | MoMo MTN succès | Confirmé automatiquement < 2 min | | |
| R-02 | MoMo Orange succès | Idem | | |
| R-03 | MoMo refusé par le payeur | `ECHOUEE`, notification d'échec | | |
| R-04 | MoMo sans action du payeur (expiration) | `ECHOUEE` ou `A_VERIFIER`, puis réconciliation | | |
| R-05 | Webhook désactivé chez le prestataire (polling seul) | Confirmé par le polling ou la réconciliation | | |
| R-06 | Relance du callback (`retry-webhook`) | Aucun double effet | | |
| R-07 | Lot de 3 rubriques en MoMo | 3 lignes confirmées ensemble | | |
| R-08 | Carte succès / refus / abandon | Statuts corrects ; retour navigateur sans effet sur le statut | | |
| R-09 | Collecte publique MoMo et carte | Reçu au donateur ; nom visible côté back-office | | |
| R-10 | Rapprochement de la période : Σ des confirmés = Σ de la console du prestataire | Écart = frais documentés | | |

## 6. Définition de « prêt pour la version »
- CI verte (tous les niveaux ci-dessus sauf charge et ZAP, exigés seulement pour une version majeure).
- Recette sandbox (§ 5) signée si les paiements sont touchés.
- Recette métier sur appareils réels signée (doc 01 § 13).
- Notes de version et plan de retour arrière prêts (doc 03 § 10).

## 7. Pipeline CI cible (GitHub Actions)

```
on: pull_request, push(main), tags(v*)
jobs:
  quality:   pnpm i --frozen-lockfile · lint (eslint + règles a11y + interdiction des hex en dur) · type-check · gitleaks · semgrep · pnpm audit --prod --audit-level=high
  unit:      vitest (shared, domaine) + couverture
  integration: service postgres:17 + redis:7 · prisma migrate deploy · vitest (api) · seuils de couverture
  web:       vitest (composants) · next build (budgets) · lighthouse-ci (mobile)
  e2e:       stack docker compose (prestataires simulés) · playwright (360×800, 390×844) · axe
  images (tags) : build · trivy · sbom · push ghcr (empreintes) → environnement « production » (2 approbations)
```
Versions d'outillage alignées : pnpm épinglé (corepack), Node 24, un seul lockfile.

*Fin de la stratégie de tests.*
