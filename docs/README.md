# Documentation SGM-CEM

Organisation de la documentation du projet (réorganisée le 2026-07-16).

## À la racine du dépôt (opérationnel — ne pas déplacer)
| Fichier | Rôle |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | Point d'entrée Claude Code — chargé automatiquement à chaque session |
| [`DEPLOIEMENT_DOCKER.md`](../DEPLOIEMENT_DOCKER.md) | **Lecture obligatoire** avant toute tâche déploiement/config — les 8 pièges du projet |

## `docs/reference/` — documents de référence vivants
| Fichier | Rôle |
|---|---|
| [`GUIDE_SGM_CEM.md`](reference/GUIDE_SGM_CEM.md) | Guide d'utilisation (accès, rôles, parcours utilisateur) |
| [`PAYMENT_FLOWS_SGM_CEM.md`](reference/PAYMENT_FLOWS_SGM_CEM.md) | Référence officielle des flux Mobile Money (Yelii Pro Pay) |
| [`DEVELOPER_PANEL_SGM_CEM.md`](reference/DEVELOPER_PANEL_SGM_CEM.md) | Référence du panneau développeur et de la config en base — cité par le code (`§`) |
| [`TEST_PLAN.md`](reference/TEST_PLAN.md) | Plan de test fonctionnel par module |
| [`DESIGN_SYSTEM_SGM_CEM.md`](reference/DESIGN_SYSTEM_SGM_CEM.md) | Référence UI premium : tokens, composants Ant Design, responsive et recette visuelle |
| [`CLAUDE_SGM_CEM.md`](reference/CLAUDE_SGM_CEM.md) | Spécification maître d'origine (v4.1) — conventions historiques détaillées |
| [`README-DEMARRAGE.md`](reference/README-DEMARRAGE.md) | Guide de démarrage en mode dev (hors Docker : `pnpm dev`, PostgreSQL local) |
| [`TEST_CHROME_CLAUDE.md`](reference/TEST_CHROME_CLAUDE.md) | Faire tester/corriger l'appli par Claude dans un vrai Chrome (claude-in-chrome) — pièges d'environnement (process zombies, cache SW, .next) |

## `docs/archives/` — rapports historiques (chantiers terminés, conservés pour trace)
| Fichier | Contexte |
|---|---|
| `PROGRESS_SGM_CEM.md` | Suivi d'avancement v6.0 — clos à 100 % (47/47) le 2026-07-02 |
| `SECURITY_HARDENING_REPORT.md` | Rapport du chantier de durcissement sécurité |
| `FIX_SUMMARY.md` | Résumé des corrections du debug complet |
| `NEXT_STEPS.md` | Étapes restantes du chantier sécurité (traitées) |
| `ANALYSE_COMPLETE.md` | Analyse d'architecture du chantier debug (ex-`sgm-cem/`) |
| `CORRECTIONS_APPLIQUEES.md` | Rapport de corrections du chantier debug (ex-`sgm-cem/`) |
| `RESUME_CORRECTIONS.md` | Résumé du chantier debug (ex-`sgm-cem/`) |
| `AUDIT_COMPLET_2026-07-25.md` | Audit complet avant déploiement (technique, sécurité, contributions/paiements, BDD, flows) sur l'état non commité du 2026-07-25 |

## Supprimés (récupérables dans l'historique git)
`PROMPT_FONDS_COLLECTEURS_UPDATE.md`, `PROMPT_REFONTE_DESIGN_SGM_CEM.md` —
prompts d'instruction one-shot, entièrement exécutés (fonctionnalités livrées) ;
`apps/api/tsc_*.txt` — artefacts de debug de compilation.
