# Documentation SGM-CEM

Dossier de référence v1.0 (17/10/2026), plus les documents historiques. Ordre de lecture recommandé :
- Bureau / Trésorier : `specifications/` §§ 1, 3, 4, 9, 12 → `pilotage/` → `exploitation/03` §§ 0 et 3.
- Développeur : ce fichier → `architecture/` → `specifications/` §§ 4–7 → `qualite/`.
- Opérateur / astreinte : `exploitation/03` → `exploitation/05` → `securite/` §§ 2.6 et 2.8.

## À la racine du dépôt (opérationnel — ne pas déplacer)
| Fichier | Rôle |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | Point d'entrée Claude Code — chargé automatiquement à chaque session |
| [`DEPLOIEMENT_DOCKER.md`](../DEPLOIEMENT_DOCKER.md) | Environnement **de développement** Docker local — les pièges du projet |

## Dossier de référence (v1.0)
| Document | Rôle |
|---|---|
| [`specifications/01_CAHIER_DES_CHARGES_FONCTIONNEL.md`](specifications/01_CAHIER_DES_CHARGES_FONCTIONNEL.md) | Exigences fonctionnelles (EF), règles de gestion (RG), matrice des droits, cycles de vie, parcours mobiles, exigences non fonctionnelles |
| [`architecture/02_DOSSIER_ARCHITECTURE_TECHNIQUE.md`](architecture/02_DOSSIER_ARCHITECTURE_TECHNIQUE.md) | Existant, architecture cible, décisions (ADR), versions cibles, propositions d'amélioration |
| [`exploitation/03_GUIDE_DEPLOIEMENT_PRODUCTION.md`](exploitation/03_GUIDE_DEPLOIEMENT_PRODUCTION.md) | **Normatif** — check-list GO/NO-GO, serveur, Compose de production, sauvegardes, procédures, retour arrière |
| [`exploitation/05_RUNBOOK_EXPLOITATION.md`](exploitation/05_RUNBOOK_EXPLOITATION.md) | Incidents, contrôles de routine, communication |
| [`securite/04_POLITIQUE_SECURITE_CONFORMITE.md`](securite/04_POLITIQUE_SECURITE_CONFORMITE.md) | Exigences de sécurité [S-xx], secrets, loi n° 2024/017 (données personnelles) |
| [`qualite/06_STRATEGIE_TESTS_RECETTE.md`](qualite/06_STRATEGIE_TESTS_RECETTE.md) | Pyramide de tests, matrice RBAC, recette sandbox des prestataires |
| [`qualite/08_CONVENTIONS_DEVELOPPEMENT.md`](qualite/08_CONVENTIONS_DEVELOPPEMENT.md) | Conventions API et web, définition de « terminé », modèle de PR |
| [`pilotage/07_FEUILLE_DE_ROUTE.md`](pilotage/07_FEUILLE_DE_ROUTE.md) | Phases 0 à 4, jalons, indicateurs |
| [`pilotage/AVANCEMENT.md`](pilotage/AVANCEMENT.md) | Journal d'avancement de la feuille de route (mis à jour à chaque phase) |
| [`audit/09_RAPPORT_AUDIT_SGM-CEM.md`](audit/09_RAPPORT_AUDIT_SGM-CEM.md) | Rapport d'audit du 17/10/2026 (constats V-xx, UX-xx, preuves) |

## `reference/` — documents de référence historiques (toujours valables sauf contradiction avec le dossier v1.0)
| Fichier | Rôle |
|---|---|
| [`GUIDE_SGM_CEM.md`](reference/GUIDE_SGM_CEM.md) | Guide d'utilisation |
| [`PAYMENT_FLOWS_SGM_CEM.md`](reference/PAYMENT_FLOWS_SGM_CEM.md) | Flux Mobile Money (Yelii Pro Pay) |
| [`DEVELOPER_PANEL_SGM_CEM.md`](reference/DEVELOPER_PANEL_SGM_CEM.md) | Panneau développeur et configuration en base — cité par le code (`§`) |
| [`COLLECTION_VALIDATION_MOBILE.md`](reference/COLLECTION_VALIDATION_MOBILE.md) | Décisions du 18/09/2026 : périmètres, validation, mobile |
| [`DASHBOARD_TRESORERIE_FONDS.md`](reference/DASHBOARD_TRESORERIE_FONDS.md) | Décisions trésorerie |
| [`MULTI_RUBRIQUE_PAYMENTS.md`](reference/MULTI_RUBRIQUE_PAYMENTS.md) | Paiements répartis |
| [`OBSERVABILITE_ADMIN_SGM_CEM.md`](reference/OBSERVABILITE_ADMIN_SGM_CEM.md) | Observabilité administrateur |
| [`TEST_PLAN.md`](reference/TEST_PLAN.md) | Plan de test fonctionnel historique |
| [`CLAUDE_SGM_CEM.md`](reference/CLAUDE_SGM_CEM.md) | Spécification maître d'origine (v4.1) |
| [`README-DEMARRAGE.md`](reference/README-DEMARRAGE.md) | Démarrage en mode dev hors Docker |

## `archives/` — rapports historiques (chantiers terminés)
Voir le contenu du dossier ; ces documents ne font plus foi.
