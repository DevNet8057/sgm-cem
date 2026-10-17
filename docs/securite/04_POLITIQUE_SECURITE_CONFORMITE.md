# Politique de sécurité et de conformité — SGM-CEM

| Élément | Valeur |
|---|---|
| Version | 1.0 — 17/10/2026 |
| Propriétaire | Responsable technique (DEVELOPER), validé par l'ADMIN et le Trésorier |
| Revue | Annuelle, et après tout incident de sécurité |
| Documents liés | `02` (§ 5.6), `03` (§ 1, § 3, § 14), `05_RUNBOOK_EXPLOITATION.md` (incidents) |

> Cette politique est **opposable** aux développeurs, au staff et aux prestataires techniques. Les exigences notées **[S-xx]** sont vérifiées en revue de code, en CI ou en audit.

---

## 1. Classification des données

| Classe | Exemples | Règles |
|---|---|---|
| **C3 — Critique** | Secrets (JWT, CSRF, clés prestataires, mots de passe Postgres et Redis, clé de chiffrement de configuration, mot de passe restic), hash de mots de passe | Jamais en clair hors du `.env` ou du coffre ; chiffrés en base ; jamais journalisés ; accès DEVELOPER uniquement |
| **C2 — Confidentiel** | Données personnelles (noms, téléphones, e-mails, dates de naissance, profession), contributions et montants, reçus, journal d'audit | Accès selon la matrice RBAC (doc 01 § 4) ; chiffrement en transit ; sauvegardes chiffrées ; pas d'export non anonymisé hors production |
| **C1 — Interne** | Rubriques, statistiques agrégées, documents GED approuvés | Accès aux utilisateurs authentifiés selon le rôle |
| **C0 — Public** | Page publique d'une collecte (titre, description, montants suggérés) | Ne jamais y exposer de total, de nom de donateur ni d'identifiant interne exploitable |

---

## 2. Exigences de sécurité applicative

### 2.1 Identité et sessions
- **[S-01]** Mots de passe hachés en Argon2id (paramètres OWASP : m=19 Mio, t=2, p=1 au minimum). Rehachage progressif des hash bcrypt existants.
- **[S-02]** Longueur ≥ 10, au moins une majuscule et un chiffre ; refus de la liste des mots de passe compromis et des mots de passe par défaut historiques ; changement forcé **côté serveur** après création ou réinitialisation.
- **[S-03]** Aucun mot de passe par défaut dans le code, le seed ou la documentation. Les mots de passe temporaires sont aléatoires (≥ 12 caractères) et affichés une seule fois.
- **[S-04]** Jeton d'accès de 15 min ; jeton de rafraîchissement de 7 j **renouvelé à chaque usage**, avec détection de réutilisation (révocation de toute la famille) ; contrôle `isActive` et version de jeton à chaque rafraîchissement.
- **[S-05]** Révocation immédiate des sessions : désactivation, changement ou réinitialisation de mot de passe, changement de rôle, demande de l'utilisateur.
- **[S-06]** OTP : `crypto.randomInt`, haché en base, 5 min, 3 essais, limites par numéro **et** par IP, réponse identique que le numéro existe ou non.
- **[S-07]** Google : `aud` et `email_verified` vérifiés ; compte préexistant obligatoire.
- **[S-08]** Impersonation : DEVELOPER uniquement, 1 h, bandeau, audit au début et à la fin ; interdite vers un DEVELOPER ; **aucune action financière irréversible** sous impersonation (confirmation, dépôt, remboursement) 🆕.

### 2.2 Autorisation
- **[S-10]** Toute route vérifie l'action **et** l'enregistrement via le module `policy` (ADR-003). Un enregistrement hors périmètre renvoie 404 (pas 403), pour ne pas révéler son existence.
- **[S-11]** Les capacités (`actions`) sont calculées par l'API ; le web n'a aucune règle d'autorisation propre.
- **[S-12]** Séparation des tâches : celui qui encaisse ne valide pas seul l'entrée en caisse ; le remboursement exige deux approbateurs (doc 01, M16).
- **[S-13]** Tests automatiques de la matrice « rôle × action × périmètre » obligatoires pour toute route financière.

### 2.3 Entrées, sorties et injections
- **[S-20]** Toute entrée est validée par Zod (corps, paramètres, requête), en mode strict pour les objets.
- **[S-21]** Aucune interpolation de données dans du HTML sans échappement (PDF, e-mails) ; moteur de modèles à échappement automatique ; rendu PDF sans JavaScript ni réseau.
- **[S-22]** Requêtes SQL via Prisma uniquement ; `$queryRaw` seulement avec des modèles paramétrés (`Prisma.sql`), jamais `$queryRawUnsafe`.
- **[S-23]** Téléversements : liste blanche de types **vérifiée sur le contenu** (magic bytes), taille bornée, nom de fichier aléatoire, bucket privé, `Content-Disposition: attachment` pour la GED, URL signées de courte durée.
- **[S-24]** Réponses d'erreur : jamais de pile d'appels, de requête SQL ni de détail fournisseur ; `requestId` fourni pour le support.

### 2.4 Protection web
- **[S-30]** Même origine (ADR-002) ; cookies `__Host-` (option), `Secure`, `HttpOnly` (sauf le cookie CSRF), `SameSite=Strict`.
- **[S-31]** CSRF double-submit sur toutes les mutations (hors webhooks signés) ; `CSRF_SECRET` obligatoire.
- **[S-32]** En-têtes : CSP avec nonces (Next), HSTS, `nosniff`, `X-Frame-Options: DENY` (ou `frame-ancestors 'none'`), `Referrer-Policy`, `Permissions-Policy`.
- **[S-33]** Limitation de débit derrière `trust proxy` : par IP pour les routes anonymes, par utilisateur pour les routes authentifiées, par identifiant (e-mail, téléphone) pour la connexion et l'OTP. Store Redis.
- **[S-34]** Zoom autorisé (accessibilité) : sans effet sur la sécurité, mentionné ici pour éviter les régressions.

### 2.5 Paiements
- **[S-40]** Webhooks : signature vérifiée sur le **corps brut**, en temps constant ; anti-rejeu (horodatage ± 5 min et identifiant d'événement unique) ; endpoint hors CSRF uniquement pour ces routes.
- **[S-41]** Aucun statut de paiement n'est accepté depuis le navigateur ; le serveur vérifie toujours auprès du prestataire (RG-10).
- **[S-42]** Contrôle du montant et de la devise à la confirmation (RG-11) ; idempotence (RG-12) ; aucune confirmation manuelle d'un paiement électronique (RG-13).
- **[S-43]** Appels sortants vers les prestataires : hôtes fixés (liste blanche), délai d'expiration de 10 s, redirections refusées.

### 2.6 Secrets
- **[S-50]** Secrets d'infrastructure uniquement dans `.env` (600) et dans le coffre de l'association (gestionnaire de mots de passe partagé, accès 2 personnes).
- **[S-51]** Secrets métier dans `system_configs`, **chiffrés** (AES-256-GCM, clé `CONFIG_ENCRYPTION_KEY`) ; révélation après réauthentification et auditée ; historique sans valeur en clair.
- **[S-52]** Rotation : annuelle ; immédiate en cas de départ d'une personne ayant eu accès, ou de fuite suspectée (procédure dans le runbook 05 § 4.6).
- **[S-53]** Détection de secrets en CI (`gitleaks`) ; tout secret commité est considéré compromis et **révoqué**, même après réécriture de l'historique. *Cas ouvert : clé au format Yelii dans `docs/reference/PAYMENT_FLOWS_SGM_CEM.md` (3 occurrences, introduites au commit `aecc4d0`).*

### 2.7 Dépendances et chaîne logicielle
- **[S-60]** `pnpm audit --prod --audit-level=high` bloquant en CI ; Renovate hebdomadaire ; correctifs de sécurité critiques appliqués sous **72 h**, élevés sous **14 jours**.
- **[S-61]** Versions épinglées (lockfile), images épinglées par empreinte, aucune RC ni canary en production.
- **[S-62]** Scan des images (Trivy) et SBOM CycloneDX archivés par version.
- **[S-63]** Socle supporté : versions LTS uniquement (Node 24 au 17/10/2026). Une version en fin de vie est un incident de conformité.

### 2.8 Infrastructure
- **[S-70]** Seuls 80, 443 et 22 (restreint) sont ouverts ; base, Redis, API et web restent internes (contrôle `ss -tlnp` à chaque déploiement).
- **[S-71]** SSH par clé uniquement, root interdit, fail2ban, mises à jour de sécurité automatiques.
- **[S-72]** Conteneurs non-root, `no-new-privileges`, `cap_drop: ALL`, systèmes de fichiers en lecture seule si possible.
- **[S-73]** Sauvegardes chiffrées (restic), hors site, immuables 30 j ; restauration testée chaque mois.

### 2.9 Journalisation
- **[S-80]** Journal d'audit métier en ajout seul (rôle SQL sans UPDATE ni DELETE), auteur réel (y compris sous impersonation), IP, agent utilisateur.
- **[S-81]** Journaux techniques structurés, **sans** mot de passe, jeton, OTP, clé, ni numéro complet (masquer : `+2376••••••01`).
- **[S-82]** Alertes de sécurité : échecs de connexion en rafale, révélation de secret, impersonation, changement de rôle vers ADMIN ou DEVELOPER, modification de clé prestataire → notification à l'ADMIN et au DEVELOPER.

---

## 3. Conformité — loi camerounaise n° 2024/017 (données personnelles)

> La loi n° 2024/017 du 23 décembre 2024 portant protection des données à caractère personnel est **en vigueur depuis le 23 juin 2026**. Elle crée l'Autorité de protection des données à caractère personnel (APDP) et soumet les transferts de données hors du territoire à un niveau de protection équivalent et à une autorisation préalable de l'autorité. **Les points ci-dessous sont une grille de mise en conformité technique ; ils DOIVENT être validés par un juriste**, notamment sur les obligations déclaratives, les durées de conservation et le statut de l'association.

### 3.1 Responsable de traitement et rôles
- Responsable de traitement : le CEM (EEC Melen), représenté par ⟨fonction⟩.
- Référent données personnelles : ⟨nom⟩ (ADMIN).
- Sous-traitants : voir § 3.3.

### 3.2 Registre des traitements (à tenir à jour)

| Traitement | Finalité | Personnes | Données | Base (à valider) | Destinataires | Conservation |
|---|---|---|---|---|---|---|
| Gestion des membres | Vie associative, contacts | Membres | Identité, coordonnées, catégorie, groupe, statut, profil, profession, date de naissance | Intérêt légitime / adhésion | Staff habilité | Adhésion + 3 ans |
| Contributions et reçus | Collecte, comptabilité, transparence | Membres, donateurs externes | Identité, téléphone, montants, moyens, dates | Obligation comptable / exécution | Staff habilité, prestataires de paiement | 10 ans (pièces comptables) |
| Paiements électroniques | Encaissement | Payeurs | Téléphone MoMo, montant, référence | Exécution | Yelii, CinetPay | 10 ans |
| Notifications | Information des personnes | Membres, staff, donateurs | Téléphone, e-mail, contenu des messages | Intérêt légitime / consentement (externes) | 360dialog/Meta, Twilio, fournisseur SMTP | Journaux : 1 an |
| Sécurité et audit | Traçabilité, prévention de la fraude | Utilisateurs | Actions, IP, agent utilisateur | Intérêt légitime | DEVELOPER, ADMIN | 10 ans (IP : 1 an) |
| Observabilité | Support, amélioration | Utilisateurs | Présence, temps par page | Intérêt légitime | ADMIN, DEVELOPER | 90 j |
| Collectes publiques | Dons de non-membres | Donateurs externes | Nom, téléphone, e-mail, champs personnalisés | **Consentement** (case à cocher) | Trésorier, Admin | 10 ans pour la pièce ; identité anonymisée après 3 ans |

### 3.3 Sous-traitants et transferts hors du Cameroun

| Sous-traitant | Service | Localisation probable des données | Action requise |
|---|---|---|---|
| Hébergeur du VPS | Calcul, base | Selon le choix (GO-40) | Contrat ; si hors Cameroun : démarche APDP |
| Stockage objet et sauvegardes (S3/R2/Supabase…) | Fichiers, sauvegardes | Selon la région choisie | Contrat, région, chiffrement côté client des sauvegardes |
| Yelii | Mobile Money | ⟨à confirmer auprès de Yelii⟩ | Contrat, clauses données |
| CinetPay | Carte | ⟨à confirmer⟩ | Contrat |
| 360dialog / Meta | WhatsApp | UE / États-Unis | Transfert hors territoire : démarche APDP |
| Twilio | SMS | États-Unis | Transfert hors territoire : démarche APDP |
| Fournisseur SMTP | E-mail | ⟨selon fournisseur⟩ | Contrat |
| Google | Connexion (admin) | États-Unis | Limiter aux comptes du staff |
| Suivi d'erreurs (Sentry SaaS) | Erreurs | UE / États-Unis | Préférer GlitchTip auto-hébergé, ou filtrer toute donnée personnelle |

### 3.4 Droits des personnes (mise en œuvre technique)
- **Information** : page Confidentialité (finalités, destinataires, durées, droits, contact) ; lien sur la connexion, la collecte publique et les reçus.
- **Accès et portabilité** : export JSON et PDF depuis « Mon profil » (EF-M17-03).
- **Rectification** : profil modifiable ; les autres données passent par le staff.
- **Effacement et opposition** : anonymisation de l'identité (nom → « Membre anonymisé #id », téléphone et e-mail supprimés), **montants et pièces conservés** pour l'obligation comptable.
- **Délai de réponse** : celui prévu par la loi (à confirmer) ; demandes tracées dans un registre.

### 3.5 Violation de données
Procédure : runbook 05 § 4.7. Notification à l'APDP et aux personnes selon les délais et seuils prévus par la loi (à confirmer par le juriste). Le registre des violations est tenu même pour les incidents sans notification.

---

## 4. Gouvernance des accès

| Accès | Titulaires (maximum) | Revue |
|---|---|---|
| Rôle DEVELOPER | 2 | Trimestrielle |
| Rôle ADMIN | 2 | Trimestrielle |
| SSH serveur de production | 2 | Trimestrielle |
| Coffre des secrets | 2 (ADMIN + Responsable technique) | Trimestrielle |
| Consoles Yelii, CinetPay, 360dialog, Twilio, DNS, hébergeur | 2 par console, avec 2FA obligatoire | Semestrielle |

Départ d'une personne : désactivation du compte le jour même, rotation des secrets auxquels elle avait accès sous 7 jours, transfert de ses fonds détenus (procès-verbal).

---

## 5. Développement sécurisé (exigences de revue)

Check-list de revue obligatoire pour toute PR touchant l'argent, l'authentification ou les données personnelles :
1. Les droits sont vérifiés par `policy` (action **et** enregistrement), avec un test négatif.
2. La transition d'état est conditionnelle (`updateMany … WHERE état attendu` ou version) et testée en concurrence.
3. La mutation et l'audit sont dans la **même transaction**.
4. Aucun secret ni donnée personnelle n'apparaît dans les journaux.
5. Les entrées sont validées par Zod en mode strict ; les sorties ne divulguent aucun champ interne inutile.
6. Tout HTML généré est échappé.
7. La migration de schéma est réversible ou additive (expand/contract).
8. La documentation (01, 02) est mise à jour si une règle ou une décision change.

---

## 6. Tests de sécurité
- À chaque PR : SAST (Semgrep, règles OWASP et Node), `gitleaks`, `pnpm audit`, tests RBAC.
- À chaque version : scan DAST (OWASP ZAP baseline) sur la préproduction ; Trivy sur les images.
- Annuel : test d'intrusion externe ciblé (authentification, RBAC financier, paiements, webhooks, collecte publique). Correction des constats critiques avant la version suivante.

*Fin de la politique de sécurité et de conformité.*
