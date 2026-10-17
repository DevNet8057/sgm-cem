# Journal d'avancement — feuille de route SGM-CEM

Branche de travail : `claude/ecstatic-gates-g8pt2c` (créée depuis `main` au commit `ca99669`, qui reste intact).
Référence : [`07_FEUILLE_DE_ROUTE.md`](07_FEUILLE_DE_ROUTE.md).

## Décisions du Bureau (17/10/2026)
| Sujet | Décision |
|---|---|
| Mots de passe des comptes existants | **Pas de changement forcé** au déploiement. Seuls les nouveaux comptes et les réinitialisations reçoivent un mot de passe temporaire aléatoire à changer. |
| Circuit des fonds | **Circuit officiel seul** : transfert → réception par le destinataire → dépôt bancaire par le trésorier. Suppression de « Réceptionner » (claim) et de « Vers caisse / Vers banque ». |
| Paiements électroniques | Nouvelle localisation **« Portefeuille électronique »** ; les paiements Mobile Money/carte déjà confirmés y sont reclassés. |
| Montées de version majeures | **Oui** : Next 16, Express 5, Prisma 7, Zod 4 (phase 3), une par commit. |

## Protection des données existantes (avant toute modification)
- Sauvegarde complète du dépôt Git (`git bundle --all`) conservée hors dépôt.
- Scripts de sauvegarde de la base : `sgm-cem/scripts/backup-db.ps1` (Windows) et `backup-db.sh` (Linux). **À lancer avant chaque mise à jour.**
- Sauvegarde automatique au démarrage de l'API : avant toute évolution de schéma, `pg_dump` vérifié dans le volume `dbbackups` (10 dernières). Sans sauvegarde réussie, le démarrage s'arrête.
- Toutes les évolutions de schéma de ce chantier sont **additives** (aucune colonne ni table supprimée, aucune contrainte qui pourrait échouer sur des données existantes).

## État par phase
| Phase | État | Détail |
|---|---|---|
| 0.0 Protection des données | ✅ | Voir ci-dessus |
| 0 Sécuriser | ⏳ en cours | — |
| 1 Fiabiliser | ⏸ | — |
| 2 Mobile-first | ⏸ | — |
| 3 Socle et domaine | ⏸ | — |
| 4 Gouvernance | ⏸ | — |

## Actions qui restent à faire par l'association (hors code)
- **Révoquer la clé Yelii** qui figurait dans `docs/reference/PAYMENT_FLOWS_SGM_CEM.md` (exposée dans l'historique Git) et en générer une nouvelle dans la console Yelii, puis la saisir dans le panneau développeur.
