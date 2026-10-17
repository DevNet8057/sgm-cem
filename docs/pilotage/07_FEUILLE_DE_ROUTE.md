# Feuille de route de transformation — SGM-CEM

| Élément | Valeur |
|---|---|
| Version | 1.0 — 17/10/2026 |
| Hypothèse de capacité | 1 développeur à temps plein (ou 2 à mi-temps) + 1 référent métier (Trésorier) disponible 2 h par semaine ; durées en semaines calendaires |
| Principe | **Sécurité → fiabilité de l'argent → expérience mobile → socle → gouvernance.** Pas de nouvelle fonctionnalité métier avant la fin de la phase 1. |

---

## Vue d'ensemble

```
S1──S2      S3────S5        S6──────────S10          S11──────────S16        S17 →
Phase 0     Phase 1          Phase 2                  Phase 3                 Phase 4
Sécuriser   Fiabiliser       Mobile-first             Socle & domaine         Gouvernance
            ▲ JALON J1 : mise en production possible (check-list GO du doc 03)
                             ▲ JALON J2 : ouverture à tous les membres (parcours P1–P6 validés)
                                                      ▲ JALON J3 : comptabilité à date (grand livre)
```

---

## Phase 0 — Sécuriser (S1–S2)

**Objectif :** fermer toutes les failles critiques et élevées exploitables.

| # | Livrable | Réf. | Taille |
|---|---|---|---|
| 0.1 | Next 15.5.28, Node 24 dans les images, Socket.IO 4.8.4, axios 1.20, nodemailer 10, aws-sdk à jour ; `pnpm audit --prod` propre | V-01, V-19, PA-04 | S |
| 0.2 | Seed de production minimal ; suppression des mots de passe par défaut (code et docs) ; Argon2id ; `mustChangePassword` côté serveur ; mots de passe temporaires aléatoires | V-02, PA-03 | S |
| 0.3 | Brancher `contribution-access.service` : confirmation réservée aux espèces et virements, refus distinct, litige réservé au niveau ≥ 3, périmètre collecteur ; suppression de `/collecteurs/claim` et `/collecteurs/transfer` | V-03, V-04, V-10, V-11, PA-01 | S |
| 0.4 | Révocation des sessions, rotation des jetons de rafraîchissement, contrôle `isActive` | V-07 | S |
| 0.5 | Échappement HTML de tous les PDF + rendu sans JavaScript ni réseau | V-06, PA-08 (partiel) | XS |
| 0.6 | `trust proxy`, limitation par utilisateur et identifiant ; `CSRF_SECRET` obligatoire | V-09, V-18 | XS |
| 0.7 | GED réservée au niveau 2 ou plus ; « mot de passe oublié » non divulgateur ; OTP cryptographique ; unicité du WhatsApp | V-14, V-15, V-16 | S |
| 0.8 | **Révocation de la clé Yelii** exposée ; purge de la documentation ; gitleaks en CI | V-17 | XS |

**Sortie :** preuves P1 à P5 de l'audit rejouées en échec ; CI verte ; 0 vulnérabilité critique ou élevée en production.

## Phase 1 — Fiabiliser l'argent et l'exploitation (S3–S5)

| # | Livrable | Réf. | Taille |
|---|---|---|---|
| 1.1 | Confirmation des lots au total, en bloc ; reprise des lots existants | V-05, PA-02 | M |
| 1.2 | `payment_attempts` + clé d'idempotence fournisseur ; initialisation incertaine réconciliable ; réservation atomique des brouillons publics | V-12, PA-09 (partiel) | M |
| 1.3 | Transitions conditionnelles : transferts, dépôts (transaction), confirmations | V-13 | S |
| 1.4 | Migrations : ligne de base + `migrate deploy` ; entrypoint sans `db push` ni seed | PA-05, ADR-006 | S |
| 1.5 | CI réparée : seed de test, isolation, couverture, matrice RBAC, lint web | V-31, doc 06 | M |
| 1.6 | Artefacts de déploiement (`deploy/` : Compose de production, Caddyfile, scripts de sauvegarde et de restauration-test) ; Dockerfiles durcis | doc 03 | S |
| 1.7 | Observabilité minimale : pino + requestId, suivi d'erreurs, sonde, alertes | PA-13 | S |
| 1.8 | Lot UX bloquant : écrans collecteur manquants (UX-02), reçus et totaux serveur pour le membre (UX-03), page publique complète et champ téléphone (UX-04) | UX-02/03/04 | S |
| 1.9 | Conformité minimale : page Confidentialité, consentement des donateurs, registre, avis juridique sur l'hébergement | EF-M17, doc 04 | S |

**JALON J1 — mise en production possible** quand la check-list GO du doc 03 § 3 est verte.

## Phase 2 — Expérience mobile-first (S6–S10)

| # | Livrable | Réf. | Taille |
|---|---|---|---|
| 2.1 | **antd v6** (correctif testé) + API sémantique, sans sélecteur `.ant-*` | ADR-008 | XS |
| 2.2 | **Une route par écran** (App Router), groupes `(membre)`, `(staff)`, `(admin)`, feuilles en routes interceptées ; bouton retour et rafraîchissement corrects | UX-01 | M |
| 2.3 | Barre d'onglets par rôle avec badges ; accueils par rôle (doc 01, EF-M10-01) | UX-05, UX-16 | M |
| 2.4 | Parcours « Payer » en 3 écrans ; « Encaisser » unique ; confirmations financières avec récapitulatif | UX-11, UX-07 | M |
| 2.5 | Listes compactes + détail en feuille ; pagination serveur ; regroupement des fonds par collecteur | UX-09, UX-10 | M |
| 2.6 | Accessibilité : zoom, 16 px, 44 px, libellés liés, contrastes, `aria-live` ; axe en CI | UX-08 | S |
| 2.7 | Performance : découpage, `next/dynamic`, `next/font`, budget Lighthouse ; suppression de Radix et des doublons UI | UX-12, UX-15 | S |
| 2.8 | Bannière push contextuelle ; PWA complète (maskable, mise à jour, hors ligne idempotent) | UX-06, UX-17, V-20 | S |

**JALON J2 — ouverture à tous les membres** : parcours P1 à P6 validés sur appareils réels ; budgets ENF-01 et ENF-08 respectés.

## Phase 3 — Socle et domaine (S11–S16)

| # | Livrable | Réf. | Taille |
|---|---|---|---|
| 3.1 | Processus worker + BullMQ (PDF, notifications avec outbox, webhooks en inbox, réconciliation, crons) | ADR-001, PA-07 | M |
| 3.2 | Gotenberg (ou Puppeteer isolé dans le worker) | ADR-007 | S |
| 3.3 | Machine à états unique + `fund_movements` + `detenteurId` + localisation `COMPTE_PRESTATAIRE` + reversements | ADR-004, PA-10, EF-M07-06 | L |
| 3.4 | Découpage modulaire de l'API (contributions, paiements, trésorerie d'abord) ; singleton Prisma ; agrégations SQL | § 5.3 du doc 02, PA-11 | L |
| 3.5 | Express 5, Zod 4, Next 16, Prisma 7 (dans cet ordre, une PR par composant) | ADR-009 | M |
| 3.6 | Chiffrement des secrets en base ; réauthentification à la révélation | PA-14 | S |
| 3.7 | OpenAPI généré + client typé | PA-15 | M |

**JALON J3 — comptabilité à date** : contrôle d'invariant quotidien vert ; position des fonds reconstituable à toute date.

## Phase 4 — Gouvernance et évolutions (S17 et après)

| # | Livrable | Réf. |
|---|---|---|
| 4.1 | Remboursements à double validation | M16, PA-16 |
| 4.2 | Clôture mensuelle et verrouillage des périodes | EF-M07-09 |
| 4.3 | Demande de remise, relances automatiques (déclarations, transferts, fonds en retard) | EF-M06-07, EF-M07-04/08 |
| 4.4 | Autorisation de substitution (trésorier) | EF-M06-06 |
| 4.5 | Paramètres utiles : ratios appliqués, reconduction annuelle, membres inactifs, mode maintenance ; purge des clés sans effet | EF-M04-02/03, EF-M03-07, EF-M14 |
| 4.6 | Exports côté serveur ; droits des personnes (export, anonymisation) | EF-M10-04, EF-M17 |
| 4.7 | GED (droits par commission, conservation, versions) ; prestations → trésorerie | M11, M12 |
| 4.8 | Test d'intrusion externe annuel | doc 04 § 6 |

---

## Indicateurs de pilotage (revue mensuelle du Bureau)

| Indicateur | Source | Cible |
|---|---|---|
| Vulnérabilités critiques ou élevées en production | CI / Trivy | 0 |
| Paiements électroniques confirmés automatiquement en moins de 15 min | Métriques | ≥ 99 % |
| Paiements `A_VERIFIER` de plus de 24 h | Métriques | 0 |
| Fonds `CHEZ_COLLECTEUR` au-delà de la rétention | Tableau trésorerie | 0 |
| Écart du contrôle d'invariant | Job quotidien | 0 |
| Disponibilité | Sonde | ≥ 99,5 % |
| LCP de l'accueil membre (3G simulée) | Lighthouse CI | ≤ 3,5 s |
| Violations axe sérieuses | CI | 0 |
| Restauration testée ce mois | Procès-verbal | Oui |
| Part des paiements initiés par les membres | Statistiques | ≥ 40 % |

## Risques du programme

| Risque | Probabilité | Impact | Parade |
|---|---|---|---|
| Capacité de développement insuffisante (bénévolat) | Élevée | Élevé | Prioriser strictement les phases 0 et 1 ; geler les nouvelles fonctionnalités |
| Évolution des API Yelii ou CinetPay | Moyenne | Élevé | Couche d'adaptation, tests de contrat, canari sandbox |
| Contrainte APDP sur l'hébergement hors Cameroun | Moyenne | Moyen | Avis juridique en phase 1 ; plan B d'hébergement local |
| Régression lors des montées de version (Express 5, Prisma 7) | Moyenne | Moyen | Une PR par composant, CI complète, préproduction |
| Résistance au changement (nouveaux parcours) | Moyenne | Moyen | Pilote avec 2 collecteurs et 10 membres ; tutoriels vidéo courts en français |

*Fin de la feuille de route.*
