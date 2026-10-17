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
| 1 Fiabiliser | ✅ 17/10/2026 | Voir « Phase 1 — détail » ; jalon J1 : reste la partie serveur et juridique de la check-list GO |
| 2 Mobile-first | ✅ 17/10/2026 | Voir « Phase 2 — détail » ; jalon J2 : reste la validation des parcours sur appareils réels |
| 3 Socle et domaine | ⏳ en cours | — |
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

## Phase 1 — détail (livré)
| Lot | Livré | Vérification |
|---|---|---|
| 1.1 Lots | Moteur unique de confirmation **par transaction** (sondage, webhooks Yelii/CinetPay, réconciliation) : montant comparé au total du lot, toutes les lignes confirmées ensemble, une seule notification ; la réconciliation reprend enfin le mode YELII (lots existants débloqués) | P1 rejouée : **corrigée** (tests `phase1-payments`) |
| 1.2 Tentatives | Table `payment_attempts` ; webhook orphelin rattaché à l'unique tentative incertaine de même montant/numéro (sinon alerte) ; brouillons publics réservés atomiquement | Tests `phase1-attempts`, `public-collectes` (double soumission simultanée) |
| 1.3 Transitions | Transferts confirmer/refuser/annuler conditionnels ; dépôt bancaire en transaction ; un refus rend les fonds à leur détenteur réel | Circuit complet vérifié sur API réelle (double envoi, double confirmation, double dépôt refusés) |
| Décision Bureau | Localisation **« Portefeuille électronique »** ; reclassement des paiements électroniques confirmés non versés (y compris ceux « en caisse ») ; dépôt bancaire possible depuis ce compte | Migration testée sur copie de base peuplée |
| 1.4 Migrations | `prisma migrate deploy` au démarrage (après sauvegarde) ; adoption unique des bases `db push` ; CI : contrôle d'écart schéma/migrations | Base peuplée (26 utilisateurs / 81 contributions identiques avant/après) et base vierge : 0 écart |
| 1.5 CI | Matrice RBAC (garde d'authentification sur les 129 routes découvertes automatiquement + droits par rôle), couverture avec plancher, lint et tests web | 300 tests API, 23 tests web |
| 1.6 Déploiement | `deploy/` : Compose de production, Caddyfile, `.env` modèle, scripts de sauvegarde restic et de test de restauration ; images épinglées ; build en échec si `tsc` échoue | `docker compose config` et `caddy validate` OK ; **construction et démarrage des images non testés** (pas de démon Docker ici) |
| 1.7 Observabilité | Journaux JSON (pino) avec identifiant de requête, sonde `/api/health/ready`, Sentry/GlitchTip facultatif sans données personnelles | Vérifié sur API réelle |
| 1.8 UX bloquante | UX-02 (écrans collecteur), UX-03 (totaux serveur, reste à payer, reçus membre), UX-04 (titre, urgence, étapes, téléphone, erreurs) | Captures Playwright 360 px |
| 1.9 Conformité | Page Confidentialité complète ; consentement explicite des donateurs (case obligatoire, horodaté et versionné en base, exigé par l'API) ; registres des demandes et des violations (`docs/securite/REGISTRES_DONNEES.md`) | Parcours vérifié dans le navigateur |

Reporté (avec raison) : utilisateur non-root dans les images (propriété des volumes existants à reprendre, nécessite un test Docker réel) → phase 3.

## Phase 2 — détail (livré)
| Lot | Livré | Vérification |
|---|---|---|
| 2.1 antd v6 | antd 6.6 et API sémantique (`classNames`/`styles`), plus aucun sélecteur `.ant-*` dans le code ; **ordre des couches CSS fixé** (`antd` sous les utilitaires Tailwind : la remise à zéro d'antd annulait des classes Tailwind, ex. liens soulignés) | Captures avant/après : seul changement visible = soulignement des liens |
| 2.2 Une URL par écran | `/dashboard/<écran>` : retour arrière, lien direct et rafraîchissement fiables ; notifications push ouvrant l'écran concerné | Navigateur réel. **Reporté à 3.4** : groupes de routes `(membre)/(staff)/(admin)` et feuilles en routes interceptées (découpage structurel, sans effet visible) |
| 2.3 Navigation par rôle | Table unique des droits (menu, onglets, accès) ; onglets orientés tâches avec badges ; bloc « À traiter » | Captures 360 px par rôle |
| 2.4 Payer / Encaisser | Paiement membre en 3 écrans (montant dû prérempli, modes indisponibles masqués) ; **un seul bouton « Encaisser »** (membre qui paie / assistant / remise à confirmer) ; récapitulatif avant toute confirmation financière | Navigateur réel |
| 2.5 Listes | Listes compactes sur deux lignes + **feuille de détail** (mobile) ; fonds **regroupés par collecteur** (repliables), barre de remise collante ; dépôt bancaire regroupé par emplacement ; utilisateurs : recherche, filtre par rôle ; plus de « Membre inconnu » (don public nommé, remise groupée attribuée) ; **bug corrigé** : le dépôt bancaire ne voyait que les 100 contributions les plus récentes ; **bug corrigé** : la recherche des contributions était ignorée par l'API ; **bugs corrigés** : exports Excel « Membres » et « Contributions » tronqués (100 ou 500 lignes) et sélecteur de membres de « Encaisser » limité à 100 → lecture de toutes les pages ; `/membres` borné (≤ 100 par page, valeur invalide sans erreur 500) | « Fonds collecteurs » 6 089 → 2 268 px ; tests `phase2-lists` (121 contributions, 2 pages) |
| 2.6 Accessibilité | Zoom autorisé, champs 16 px sur mobile, cibles 44 px, libellés liés, toasts annoncés (`aria-live`), contrastes AA (gris secondaire, sur-titres, boutons rouges, badges), graphiques décoratifs masqués avec équivalent texte, interrupteurs `role="switch"` ; **audit axe-core** (`pnpm --filter web a11y`) + job CI | axe WCAG 2.1 AA : **0 violation sérieuse ou critique** sur 24 écrans (4 rôles + pages publiques), sur la base de vérification **et** en simulation fidèle du job CI (base vierge + données de démonstration) |
| 2.7 Performance | Polices via `next/font` (auto-hébergées), écrans chargés à la demande (`next/dynamic`), 10 paquets Radix inutilisés retirés | `/dashboard` : **866 kB → 139 kB** de JavaScript au premier chargement |
| 2.8 Push et PWA | Bannière de notifications sur l'accueil seulement, « Plus tard » retenu 30 jours, activation depuis « Mon profil » ; icônes maskable ; service worker v4 (pas de page d'erreur en cache) ; **saisie hors ligne idempotente** (clé `clientRequestId`, migration additive) | Rejeu simulé dans le navigateur : 1 seule contribution ; tests `phase2-offline` |
| Migrations | L'adoption d'une base `db push` n'utilise plus `db push` : SQL de `migrate diff` appliqué en transaction, **refusé s'il supprime quoi que ce soit** | Base `main` historique, base de vérification (montants identiques), refus d'une colonne à supprimer |

Non fait (avec raison) : budget Lighthouse en CI (mesure ponctuelle ci-dessous, pas de seuil bloquant tant que la CI GitHub ne tourne pas) ; validation sur appareils réels (jalon J2) — à faire par l'équipe avec 2 ou 3 téléphones Android d'entrée de gamme.

## ⚠️ Avant de déployer cette version
1. **Sauvegarder** la base (`scripts/backup-db.ps1`) — l'API le fait aussi automatiquement au démarrage.
2. Dans le `.env` racine : `CSRF_SECRET`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET` doivent faire **≥ 32 caractères** (`openssl rand -base64 48`), sinon l'API refuse de démarrer en production.
3. Les utilisateurs connectés devront se reconnecter **une fois** (nouveau format de session).
4. Reconstruire les images (`docker compose build`) : passage à Node 24.
5. Premier démarrage : l'API sauvegarde la base, l'**adopte** dans le système de migrations puis reclasse les paiements électroniques dans « Portefeuille électronique » (la sauvegarde garde l'état d'avant).
6. Après la mise à jour, les trésoriers peuvent recevoir des alertes sur d'anciens paiements Mobile Money bloqués : c'est la réconciliation qui reprend enfin les paiements répartis.
7. Si un téléphone garde des contributions saisies hors ligne avec l'ancienne version, elles sont envoyées normalement à la reconnexion (sans protection anti-doublon pour ces anciennes saisies seulement) : vérifier la file avant la mise à jour si possible.

## Actions qui restent à faire par l'association (hors code)
- **Révoquer la clé Yelii** qui figurait dans `docs/reference/PAYMENT_FLOWS_SGM_CEM.md` (exposée dans l'historique Git) et en générer une nouvelle dans la console Yelii, puis la saisir dans le panneau développeur.
- Lancer `audit-default-passwords.ts` (voir `DEPLOIEMENT_DOCKER.md`) pour savoir quels comptes utilisent encore l'ancien mot de passe commun, et prévenir leurs titulaires (rien n'est forcé, conformément à la décision du Bureau ; `FORCE_CHANGE=1` si le Bureau le décide).
- Vérifier si un compte `admin@gmail.com` a été créé par l'ancien script `create-admin-gmail.ts` (mot de passe connu) : le désactiver ou le réinitialiser.
- **CI GitHub** : depuis au moins le 30/09/2026, aucun job ne démarre (échec en ~3 s, sans journal) — y compris sur `main`. Cause probable côté compte GitHub (minutes ou facturation GitHub Actions) : à vérifier dans *Settings → Billing → Actions*. Les vérifications de ce chantier ont été faites localement (suite complète sur base vierge).
- **Avis juridique** (loi n° 2024/017) : hébergement, prestataires hors Cameroun (WhatsApp, Twilio, Google), durées de conservation, démarches auprès de l'APDP.
- Choisir l'hébergement de production, puis tester `deploy/` sur un serveur de préproduction (construction des images, démarrage, restauration).
