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
| 0 Sécuriser | ✅ 17/10/2026 | Voir « Phase 0 — détail » ci-dessous |
| 1 Fiabiliser | ⏸ | — |
| 2 Mobile-first | ⏸ | — |
| 3 Socle et domaine | ⏸ | — |
| 4 Gouvernance | ⏸ | — |

## Phase 0 — détail (livré)
| Lot | Livré | Vérification |
|---|---|---|
| 0.1 Dépendances | Next 15.5.28, Node 24 LTS (images Docker et CI), Puppeteer 25, Socket.IO 4.8.4, axios 1.20, nodemailer 10, multer 2.4, aws-sdk 3.1152 (sommes de contrôle « si requis » pour R2/Supabase), express-rate-limit 8 ; surcharges pnpm des dépendances transitives | `pnpm audit --prod` : **aucune vulnérabilité** |
| 0.2 Mots de passe | Argon2id (`lib/password.ts`) ; anciens hachages bcrypt acceptés puis convertis à la connexion ; mots de passe temporaires aléatoires ; `mustChangePassword` imposé **par le serveur** ; seed sans mot de passe en dur (admin : `ADMIN_PASSWORD` ou aléatoire affiché une fois ; démo seulement avec `SEED_DEMO=1`) ; nouveaux membres sans mot de passe commun (connexion par code) ; script de secours `reset-admin-password.ts` ; script `audit-default-passwords.ts` (repère sans rien forcer) ; `create-admin-gmail.ts` supprimé ; mots de passe retirés des documents | Tests `phase0-security` |
| 0.3 Droits sur les contributions | `contribution-access.service` branché : confirmation réservée aux espèces/virements par le collecteur désigné ou un administrateur (substitution tracée `CONFIRM_OVERRIDE`), refus distinct (`PATCH /:id/refuse`), litige niveau ≥ 3, périmètre collecteur sur listes et détails, capacités `actions` renvoyées au web ; transitions conditionnelles (pas de double confirmation) ; saisie staff limitée à Espèces/Virement/Yelii ; `/collecteurs/claim` et `/collecteurs/transfer` → **410** ; transfert de fonds limité à ses propres fonds (admin excepté), conditionnel ; écran « Fonds Collecteurs » rebranché sur le circuit officiel (`POST /funds/transfer`) | P3, P4 rejouées : **refusées** |
| 0.4 Sessions | Identifiant de session dans chaque jeton ; contrôle à chaque requête (session existante, compte actif — cache 10 s) ; rotation du refresh token avec détection de rejeu ; révocation à la déconnexion, au changement de mot de passe, à la désactivation, au changement de rôle ; Socket.IO soumis au même contrôle | P5 rejouée : **refusée** |
| 0.5 PDF | Échappement de toutes les données des reçus, bordereaux, rapport ; rendu sans JavaScript et sans réseau (`services/pdf-render.ts`) ; e-mails échappés | Document piégé : 0 requête réseau ; reçu réel généré |
| 0.6 Réseau | `trust proxy` (`TRUST_PROXY`), limitation par utilisateur connecté sinon par IP, `CSRF_SECRET` obligatoire en production, IP d'audit fiable | Tests |
| 0.7 Divers | GED niveau ≥ 2 ; « mot de passe oublié » identique pour tous ; OTP cryptographique, stocké haché, limité par numéro, refusé si numéro partagé ; unicité du numéro WhatsApp ; avatars : extension dérivée du type MIME (un `.html` n'est plus servi) et servis à nouveau (V-23) | Tests |
| 0.8 Secrets | Clé Yelii retirée de la documentation ; gitleaks en CI (historique complet, faux positifs documentés) | gitleaks : aucun secret |
| CI | Corrigée (elle ne pouvait pas tourner : chemins `sgm-cem/`, pnpm 8) ; seed sur base jetable ; tests rendus autonomes | Simulation locale sur base vierge : **152/152** |

## ⚠️ Avant de déployer cette version
1. **Sauvegarder** la base (`scripts/backup-db.ps1`) — l'API le fait aussi automatiquement au démarrage.
2. Dans le `.env` racine : `CSRF_SECRET`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET` doivent faire **≥ 32 caractères** (`openssl rand -base64 48`), sinon l'API refuse de démarrer en production.
3. Les utilisateurs connectés devront se reconnecter **une fois** (nouveau format de session).
4. Reconstruire les images (`docker compose build`) : passage à Node 24.

## Actions qui restent à faire par l'association (hors code)
- **Révoquer la clé Yelii** qui figurait dans `docs/reference/PAYMENT_FLOWS_SGM_CEM.md` (exposée dans l'historique Git) et en générer une nouvelle dans la console Yelii, puis la saisir dans le panneau développeur.
- Lancer `audit-default-passwords.ts` (voir `DEPLOIEMENT_DOCKER.md`) pour savoir quels comptes utilisent encore l'ancien mot de passe commun, et prévenir leurs titulaires (rien n'est forcé, conformément à la décision du Bureau ; `FORCE_CHANGE=1` si le Bureau le décide).
- Vérifier si un compte `admin@gmail.com` a été créé par l'ancien script `create-admin-gmail.ts` (mot de passe connu) : le désactiver ou le réinitialiser.
