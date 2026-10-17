# Cahier des charges fonctionnel — SGM-CEM

**Système de Gestion du Ministère · Culte d'Enfants de Melen (EEC, Yaoundé)**

| Élément | Valeur |
|---|---|
| Version | 1.0 — 17/10/2026 |
| Statut | Proposition de référence, à valider par le Bureau (Trésorier, Responsable, Administrateur) |
| Base d'analyse | Code `ca99669` (branche `main`), documents `docs/reference/*`, recette mobile du 17/10/2026, rapport d'audit `RAPPORT_AUDIT_SGM-CEM.md` |
| Documents liés | `02_DOSSIER_ARCHITECTURE_TECHNIQUE.md`, `03_GUIDE_DEPLOIEMENT_PRODUCTION.md`, `04_POLITIQUE_SECURITE_CONFORMITE.md`, `06_STRATEGIE_TESTS_RECETTE.md`, `07_FEUILLE_DE_ROUTE.md` |

### Conventions de lecture

- **Identifiants** : `EF-Mxx-nn` (exigence fonctionnelle du module xx), `RG-nn` (règle de gestion), `ENF-nn` (exigence non fonctionnelle), `CA-…` (critère d'acceptation).
- **Priorité (MoSCoW)** : **M** = obligatoire pour la mise en production · **S** = devrait (prochaine version) · **C** = pourrait · **W** = hors périmètre actuel.
- **Statut constaté dans le code au 17/10/2026** :
  - ✅ conforme ;
  - ⚠️ implémenté mais non conforme à la règle (défaut ou faille) ;
  - 🟡 partiel ;
  - ❌ absent ;
  - 🆕 nouvelle exigence proposée par l'audit.
- Le verbe **DOIT** exprime une obligation vérifiable en recette. **PEUT** exprime une option.

---

## 1. Contexte et finalité

### 1.1 Contexte
Le Culte d'Enfants de Melen (CEM) est une communauté de l'Église Évangélique du Cameroun (paroisse de Melen, Yaoundé). Il finance ses activités par les contributions de ses membres : cotisations mensuelles, contributions de district, projets, dons, assistances (deuil, naissance, mariage), aide alimentaire, etc. Il reçoit aussi des dons de personnes extérieures lors de collectes ponctuelles.

Historiquement, la collecte repose sur des **collecteurs** qui reçoivent des espèces dans plusieurs sections (Temple, Mvog-Betsi, Biscuiterie, Obili, Sciences, Polytechnique). Ils les remettent ensuite au responsable ou au trésorier, qui les dépose en banque. Le Mobile Money (MTN MoMo, Orange Money) et la carte bancaire sont désormais proposés.

### 1.2 Problèmes à résoudre
1. **Traçabilité de l'argent** : savoir à tout instant qui détient quels fonds (collecteur, transit, responsable, trésorier, caisse, banque), avec preuve.
2. **Transparence envers les membres** : chaque membre connaît ce qu'il a payé, ce qu'il doit encore, et dispose d'un reçu officiel.
3. **Réduction de la fraude et des erreurs** : double validation des espèces, confirmation automatique et vérifiée des paiements électroniques, journal d'audit inaltérable.
4. **Charge administrative** : rapports financiers, relevés et exports produits automatiquement.
5. **Mobilité** : la grande majorité des utilisateurs (membres, collecteurs) utilisent un **smartphone Android d'entrée ou de milieu de gamme**, parfois sur réseau 3G instable.

### 1.3 Objectifs mesurables (indicateurs de succès)

| # | Objectif | Indicateur | Cible à 6 mois |
|---|---|---|---|
| O1 | Fiabilité financière | Écart entre total « en banque + en caisse » et relevés réels | 0 FCFA non expliqué à chaque clôture mensuelle |
| O2 | Paiements électroniques fiables | Paiements Mobile Money confirmés automatiquement (sans action humaine) | ≥ 99 % en moins de 15 minutes |
| O3 | Délai de remise des espèces | Ancienneté moyenne des fonds `CHEZ_COLLECTEUR` | ≤ 7 jours (paramètre `maxFundsRetentionDays`) |
| O4 | Adoption mobile | Paiements initiés par les membres eux-mêmes | ≥ 40 % des contributions |
| O5 | Transparence | Membres actifs disposant de leurs reçus dans l'application | 100 % |
| O6 | Qualité de service | Disponibilité mensuelle de l'application | ≥ 99,5 % |

### 1.4 Périmètre

**Inclus :**
- gestion des membres et des comptes ;
- rubriques de contribution ;
- contributions par tout moyen (espèces, Mobile Money via Yelii, carte via CinetPay, virement) ;
- validation, litiges, remboursements ;
- chaîne de détention des fonds jusqu'à la banque ;
- collectes publiques ouvertes aux non-membres ;
- notifications (in-app, push web, WhatsApp, SMS, e-mail) ;
- tableaux de bord, statistiques, rapports et exports ;
- GED des commissions ;
- suivi des prestations du groupe Génie ;
- journal d'audit et observabilité ;
- paramétrage.

**Exclus (W) :**
- comptabilité générale en partie double et liasse fiscale ;
- paie ;
- gestion multi-paroisses ou multi-organisations ;
- portefeuille électronique interne ;
- application mobile native (une **PWA** est retenue).

---

## 2. Glossaire

| Terme | Définition |
|---|---|
| **Membre** | Personne inscrite au CEM, disposant d'un compte utilisateur de rôle MEMBRE et d'une fiche membre (catégorie, groupe, statut, profil financier). |
| **Catégorie** | `MCE_EN_SERVICE`, `ENFANTS`, `DIASPORA`. *Hypothèse à confirmer : MCE = Moniteurs du Culte d'Enfants.* |
| **Groupe** | Section ou lieu de rattachement : Temple, Mvog-Betsi, Biscuiterie, Obili, Sciences, Polytechnique. |
| **Statut de suivi** | `EN_OBSERVATION`, `EN_SUIVI`, `FIN_DE_SUIVI`, `DIASPORA`. |
| **Profil financier** | `TRAVAILLEUR`, `ETUDIANT`, `COUPLE` ; il détermine le montant dû sur une rubrique. |
| **Couple** | Lien entre deux fiches membres. Le couple contribue au tarif `COUPLE`. |
| **Rubrique** | Ligne de collecte comptable : cotisation mensuelle, contribution de district, projet, assistance… Elle a un code unique, un exercice, des montants par profil (ou un montant libre), une priorité et un statut. |
| **Contribution** | Un paiement affecté à **une** rubrique, par un membre ou un contributeur externe. |
| **Lot (paiement réparti)** | Un seul débit (Mobile Money, carte ou espèces) réparti sur plusieurs rubriques ; chaque part est une contribution. |
| **Montant dû** | Montant attendu d'un membre sur une rubrique selon son profil (RG-03). |
| **Reste à payer** | Montant dû − montant confirmé, plancher 0 (RG-04). |
| **Commission Mobile Money** | Frais du prestataire Yelii supportés par le payeur (RG-05). |
| **Collecteur** | Membre du staff habilité à recevoir des espèces et à enregistrer des paiements. |
| **Déclaration** | Signalement par un payeur d'une remise d'espèces à un collecteur. Elle reste en attente jusqu'à la confirmation du collecteur. |
| **Encaissement direct** | Saisie par un collecteur d'espèces reçues en main propre, confirmée immédiatement. |
| **Localisation des fonds** | Position physique ou comptable de l'argent d'une contribution confirmée (RG-20). |
| **Transfert de fonds (remise)** | Passage de fonds d'un détenteur à un autre, validé par le destinataire. Un **bordereau** PDF est produit. |
| **Dépôt bancaire** | Enregistrement du versement en banque, avec référence et date du bordereau bancaire. |
| **Litige** | Contestation d'une contribution (montant, réalité du paiement, affectation), avec motif obligatoire. |
| **Collecte publique** | Page web accessible par lien, permettant à un non-membre de donner sur une rubrique. |
| **Contributeur externe** | Donateur non membre identifié par nom et téléphone. |
| **Brouillon de don** | Saisie partielle d'un don public, reprenable pendant 7 jours grâce à un jeton secret. |
| **Prestation (Génie)** | Prestation facturée à un commanditaire (événement), avec dépenses (« cours ») et entrées. Une commission est reversée au CEM. |
| **GED** | Gestion électronique des documents des commissions, avec circuit de validation et durée de conservation. |
| **Panneau développeur** | Espace réservé au rôle DEVELOPER pour la configuration technique à chaud. |
| **Impersonation** | Connexion d'un développeur « en tant que » un autre utilisateur, à des fins de support, limitée à 1 h et auditée. |

---

## 3. Acteurs

| Acteur | Niveau | Mission | Usage dominant |
|---|---|---|---|
| **DEVELOPER** | 6 | Exploitation technique : configuration, clés d'intégration, diagnostic, impersonation | Ordinateur |
| **ADMIN** | 5 | Gouvernance : comptes, rôles, paramètres, supervision complète, arbitrage | Ordinateur et mobile |
| **TRESORIER** | 4 | Tenue des fonds : réception des remises, caisse, banque, collectes publiques, rapports | Mobile et ordinateur |
| **RESPONSABLE** | 3 | Animation : membres, rubriques, litiges, prestations, GED, statistiques | Mobile |
| **ADJOINT_RESPONSABLE** | 3 | Mêmes droits que le Responsable (suppléance) | Mobile |
| **COLLECTEUR** | 2 | Encaisser les espèces, confirmer les déclarations qui le désignent, remettre les fonds | **Mobile exclusivement**, sur le terrain |
| **MEMBRE** | 1 | Payer, déclarer des espèces, consulter son historique et ses reçus | **Mobile exclusivement** |
| **Contributeur externe** | — | Donner via une collecte publique, sans compte | Mobile, lien WhatsApp |
| **Systèmes externes** | — | Yelii (MTN/Orange), CinetPay (carte), 360dialog (WhatsApp), Twilio (SMS), SMTP, Google Identity, stockage S3 | — |

**Principe de séparation des tâches (obligatoire) :** la personne qui encaisse ne peut pas être seule à attester l'entrée en caisse. Les règles RG-12 à RG-24 l'appliquent : une déclaration est confirmée par le collecteur désigné, un transfert est confirmé par son destinataire, et le dépôt bancaire est réservé au trésorier.

---

## 4. Matrice des droits cible (RBAC)

> Les droits DOIVENT être appliqués **par l'API sur chaque enregistrement** (périmètre et action), jamais seulement en masquant des boutons. L'API renvoie les capacités calculées (`actions.canConfirm`, etc.), comme le prévoit la décision du 18/09/2026 (`docs/reference/COLLECTION_VALIDATION_MOBILE.md`). Le service `contribution-access.service.ts` qui l'implémente existe déjà mais **n'est branché sur aucune route** (⚠️).

Légende : ● = autorisé · ◐ = autorisé sur son propre périmètre · ○ = lecture seule · — = interdit.

| Capacité | MEMBRE | COLLECTEUR | RESP./ADJ. | TRÉSORIER | ADMIN | DEV |
|---|---|---|---|---|---|---|
| Voir ses propres contributions, reçus, reste à payer | ● | ● | ● | ● | ● | ● |
| Payer pour soi (Mobile Money, carte) | ● | ● | ● | ● | ● | ● |
| Déclarer une remise d'espèces à un collecteur | ● | ● | ● | ● | ● | ● |
| Enregistrer un paiement **pour un membre** (espèces) | — | ● | ● | ● | ● | ● |
| Initier un paiement électronique pour un membre (USSD sur le téléphone du membre) | — | ● | ● | ● | ● | ● |
| Voir les contributions | ◐ (les siennes) | ◐ (attribuées) | ● | ● | ● | ● |
| Confirmer une contribution **manuelle** (espèces/virement) en attente | — | ◐ (désigné) | — (RG-14) | ◐ (désigné, ou autorisé par l'admin, RG-15) | ● (substitution tracée) | ● |
| Confirmer manuellement un paiement **électronique** | — | — | — | — | — (RG-13) | — |
| Refuser une déclaration en attente | — | ◐ | — | ◐ | ● | ● |
| Ouvrir un litige | — | — | ● | ● | ● | ● |
| Résoudre un litige | — | — | ● (non confirmante) | ● | ● | ● |
| Initier un transfert de fonds | — | ◐ (ses fonds) | ◐ (ses fonds) | ◐ | ● | ● |
| Confirmer ou refuser la réception d'un transfert | — | ◐ (destinataire) | ◐ (destinataire) | ◐ (destinataire) | ◐ (destinataire) | ◐ |
| Enregistrer un dépôt bancaire | — | — | — | ● | ● | ● |
| Vue consolidée des fonds | — | ◐ (son portefeuille) | ○ | ● | ● | ● |
| Gérer les membres (création, modification, import, couple, statut) | — | — | ● | ● | ● | ● |
| Gérer les rubriques | — | — | ● | ● | ● | ● |
| Gérer les collectes publiques | — | — | — | ● | ● | ● |
| Statistiques, rapports, exports | — | ◐ (personnel) | ● | ● | ● | ● |
| GED : consulter | — | — | ● | ● | ● | ● |
| GED : déposer, soumettre | — | — | ● | ● | ● | ● |
| GED : approuver, rejeter, archiver, supprimer | — | — | ● | ● | ● | ● |
| Prestations : consulter et saisir | — | — | ● | ● | ● | ● |
| Prestations : verser la commission | — | — | — | ● | ● | ● |
| Notifications diffusées (broadcast) | — | — | ● | ● | ● | ● |
| Journal d'audit | ◐ (sa propre activité) | ◐ | ◐ + opérations financières | ◐ + opérations financières | ● (hors config dev) | ● |
| Paramètres système (règles, identité) | — | — | — | ○ | ● | ● |
| Gestion des utilisateurs et des rôles | — | — | — | — | ● (sauf comptes DEVELOPER) | ● |
| Observabilité (présence, sessions) | — | — | — | — | ● | ● |
| Panneau développeur, impersonation | — | — | — | — | — | ● |

**Écarts constatés avec le code actuel (à corriger, priorité M) :**
- ⚠️ `PATCH /contributions/:id/confirm` est ouvert à tout niveau ≥ 2 et à tous les modes de paiement (preuve P4 de l'audit).
- ⚠️ `PATCH /collecteurs/claim` est ouvert à tout le staff (preuve P3).
- ⚠️ `PATCH /contributions/:id/litige` est ouvert au niveau 2.
- ⚠️ GED lisible au niveau 1.
- ⚠️ `PATCH /settings` est ouvert au niveau 4, alors que l'interface le réserve au niveau 5.
- ⚠️ `GET /contributions` n'applique pas de périmètre au collecteur.

---

## 5. Exigences fonctionnelles par module

### M01 — Authentification et sessions

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M01-01 | Connexion par e-mail et mot de passe. | M | ✅ |
| EF-M01-02 | Connexion par code à usage unique (OTP) à 6 chiffres envoyé par WhatsApp, avec repli SMS, valable 5 minutes et limité à 3 essais. Le numéro DOIT être unique et normalisé E.164 (+237…) sur l'ensemble des comptes. | M | 🟡 (unicité de `whatsappPhone` absente, générateur non cryptographique) |
| EF-M01-03 | Connexion Google réservée aux comptes existants dont l'e-mail Google est **vérifié**. | S | 🟡 (`email_verified` non contrôlé) |
| EF-M01-04 | À la première connexion ou après une réinitialisation, l'utilisateur DOIT changer son mot de passe avant toute autre action. Contrôle **côté serveur**. | M | ⚠️ (contrôle uniquement côté interface) |
| EF-M01-05 | Politique de mot de passe : 10 caractères minimum, au moins une majuscule et un chiffre ; refus des mots de passe connus compromis et du mot de passe par défaut. | M | 🟡 (8 caractères, pas de liste noire) |
| EF-M01-06 | Session : jeton d'accès de 15 min et de rafraîchissement de 7 jours, **renouvelé à chaque usage** (rotation). Révocation immédiate à la déconnexion, à la désactivation du compte, au changement ou à la réinitialisation du mot de passe et au changement de rôle. | M | ⚠️ (preuve P5 : un compte désactivé reste rafraîchissable) |
| EF-M01-07 | « Mot de passe oublié » : la réponse ne DOIT révéler ni l'existence du compte, ni son rôle, ni des coordonnées personnelles. Le membre reçoit un **lien ou un code de réinitialisation** par WhatsApp ou e-mail (🆕 libre-service). | M | ⚠️ (divulgue le contact de l'admin et le rôle) |
| EF-M01-08 | Liste « Mes appareils et sessions », avec déconnexion à distance. | C | ❌ 🆕 |
| EF-M01-09 | Verrouillage progressif après échecs répétés, par compte **et** par adresse IP. | M | 🟡 (par IP seulement, sans `trust proxy`) |
| EF-M01-10 | Impersonation DEVELOPER : 1 h maximum, bandeau permanent, retour en un clic, audit au début et à la fin. Interdite vers un autre compte DEVELOPER. | S | ✅ |

**CA-M01-A** — *Étant donné* un collecteur désactivé par l'admin, *quand* son application tente un rafraîchissement de session, *alors* l'API répond 401 et toutes ses sessions sont supprimées.

### M02 — Gestion des utilisateurs (ADMIN)

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M02-01 | Créer un compte staff ou membre. Le mot de passe temporaire est **aléatoire** (12 caractères au moins), affiché une seule fois et transmissible par WhatsApp. | M | ⚠️ (mot de passe par défaut codé en dur) |
| EF-M02-02 | Modifier le nom, l'e-mail, le téléphone et le rôle. Un ADMIN ne peut ni modifier, ni désactiver, ni réinitialiser un DEVELOPER. | M | ✅ |
| EF-M02-03 | Désactiver ou réactiver un compte, avec motif obligatoire, audit, et révocation immédiate des sessions (EF-M01-06). | M | ⚠️ (ni audit, ni révocation) |
| EF-M02-04 | Réinitialiser un mot de passe (aléatoire, changement forcé, sessions révoquées). | M | 🟡 |
| EF-M02-05 | Changer la photo d'un utilisateur. | C | 🟡 (non servie en stockage local) |
| EF-M02-06 | Le numéro d'identification (`memberId`, format `CEM-AAAA-NNNNNN`) est attribué de façon séquentielle et sans collision, y compris en cas de créations simultanées. | M | ⚠️ (`count()+1` dans `users.ts`) |

### M03 — Membres

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M03-01 | Créer une fiche membre : identité, contacts, catégorie, groupe, statut de suivi, profil financier, profession, adresse, date d'adhésion, date de naissance, notes. Le compte associé est créé au rôle MEMBRE. | M | ✅ |
| EF-M03-02 | Lier ou délier un couple. La liaison passe les deux fiches au profil `COUPLE` et rompt d'éventuels liens précédents, **en une seule transaction**. | M | 🟡 (liaison hors transaction) |
| EF-M03-03 | Changer le statut de suivi, avec audit. | M | 🟡 (non audité) |
| EF-M03-04 | Importer des membres depuis un modèle tableur (CSV/XLSX → JSON) avec rapport ligne à ligne (créé / rejeté / motif). L'import est atomique ou rejouable sans doublon. | S | 🟡 (atomique, sans rapport détaillé, mot de passe par défaut) |
| EF-M03-05 | Rechercher un membre par nom, téléphone ou numéro, avec filtres (groupe, catégorie, statut, profil). | M | ✅ |
| EF-M03-06 | Fiche membre consolidée : historique des contributions, reste à payer par rubrique, litiges, déclarations en attente. | S | 🟡 |
| EF-M03-07 | Signaler automatiquement les membres **inactifs** (aucune contribution confirmée depuis `inactivityMonthsThreshold` mois) aux responsables. | S | ❌ (paramètre saisi mais sans effet) |
| EF-M03-08 | Archivage d'un membre parti, sans suppression de son historique financier. | S | 🟡 (désactivation seule) |

### M04 — Rubriques

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M04-01 | Créer une rubrique : code unique, titre, description, type (`REGULIERE_MENSUELLE`, `PONCTUELLE`, `URGENTE`), priorité (`NORMAL`, `PRIORITAIRE`, `URGENT`), exercice, dates d'ouverture et de clôture, montants par profil (ou libre), objectif de collecte, public concerné. | M | ✅ |
| EF-M04-02 | **Pré-remplissage des montants** : à la saisie du montant TRAVAILLEUR, les montants ÉTUDIANT et COUPLE sont proposés selon `etudiantRatio` et `coupleRatio` (modifiables). | S | ❌ (ratios saisis dans Paramètres mais inutilisés, sauf dans un simulateur) |
| EF-M04-03 | Reconduction annuelle d'une rubrique (N → N+1) avec revalorisation de `defaultIncreaseRate` %. | C | ❌ 🆕 |
| EF-M04-04 | Ouvrir, fermer ou archiver une rubrique. Une rubrique fermée n'accepte plus de paiement ; une rubrique archivée disparaît des listes courantes. Confirmation exigée. | M | 🟡 (aucune confirmation) |
| EF-M04-05 | Suivi d'une rubrique : total confirmé, en attente, nombre de payeurs, taux de recouvrement (payeurs à jour / membres concernés), progression vers l'objectif. | S | 🟡 (total et nombre seulement) |
| EF-M04-06 | Un collecteur ne voit sur une rubrique que **ses propres** totaux ; le global est réservé au niveau 3 et plus. | S | ❌ |

### M05 — Contributions et paiements

#### M05-A Paiement par le membre (libre-service)

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M05-01 | Depuis l'accueil, le membre voit son **reste à payer** total et par rubrique (ordre : urgent > prioritaire > échéance la plus proche) et peut payer en 3 écrans au maximum : rubrique et montant (pré-rempli au reste à payer) → moyen et numéro (pré-remplis) → confirmation. | M | 🟡 (le parcours actuel impose la répartition multi-rubriques et 4 étapes, UX-11) |
| EF-M05-02 | Mobile Money (MTN, Orange) via Yelii : le montant débité inclut la commission (RG-05), affichée **avant** validation (« dont frais : X FCFA »). Une demande USSD est envoyée sur le téléphone du payeur, puis un écran d'attente avec compte à rebours et consignes s'affiche. | M | ✅ |
| EF-M05-03 | Carte bancaire via CinetPay : montant multiple de 5 FCFA (RG-07), redirection vers la page sécurisée, retour avec statut vérifié côté serveur. Le mode est masqué quand il n'est pas configuré. | M | ✅ (affiché « indisponible » au lieu d'être masqué) |
| EF-M05-04 | **Paiement réparti** : un seul débit réparti entre plusieurs rubriques (≤ 50 lignes), commission répartie selon RG-06. Le lot est confirmé **en bloc** lorsque le fournisseur confirme le montant total. | S | ⚠️ (preuve P1 : jamais confirmé automatiquement dès 2 rubriques) |
| EF-M05-05 | Déclarer une remise d'espèces à un collecteur choisi dans la liste des collecteurs actifs, sur une ou plusieurs rubriques. La déclaration reste « en attente » jusqu'à la confirmation du collecteur. | M | ✅ |
| EF-M05-06 | Historique paginé de **toutes** ses contributions, avec détail (date, rubrique, montant, frais, mode, collecteur, statut, date de confirmation, référence, motif de litige) et **téléchargement du reçu**. Les totaux sont calculés sur l'ensemble, pas sur la page. | M | ⚠️ (pas de reçu ni de détail ; totaux faux au-delà de 20 lignes) |
| EF-M05-07 | Protection contre le double paiement : un double clic, une nouvelle tentative réseau ou deux onglets ne déclenchent **jamais** deux débits (clé d'idempotence). | M | 🟡 (OK pour `/payments/initiate` et les lots ; KO pour les collectes publiques) |
| EF-M05-08 | Initialisation incertaine (délai dépassé chez le fournisseur) : le payeur est averti « Ne relancez pas, vérification en cours ». Le système retrouve la transaction et la réconcilie automatiquement (RG-10). | M | ⚠️ (la contribution reste « en cours » sans référence, jamais réconciliée) |

#### M05-B Paiements saisis par le staff

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M05-10 | **Encaisser des espèces** pour un membre (une ou plusieurs rubriques). Les espèces reçues en main propre sont confirmées immédiatement, avec génération du reçu et notification du membre. | M | ✅ |
| EF-M05-11 | Initier un Mobile Money pour un membre présent (USSD sur son téléphone). La confirmation est **uniquement automatique** (RG-13). | M | ⚠️ (confirmation manuelle possible) |
| EF-M05-12 | Remise groupée : un collecteur déclare à un autre collecteur ou au trésorier un montant reçu de plusieurs personnes non identifiées. Ce cas est **exceptionnel**, avec note obligatoire et libellé « Remise groupée ». | C | 🟡 (lignes sans membre affichées « — ») |
| EF-M05-13 | Un **seul** point d'entrée « Encaisser » pour le collecteur, qui demande d'abord « Espèces reçues en main / Déclaration à confirmer / Mobile Money ». Les trois formulaires actuels (« Rapide », « Guidé », « Déclarer ») sont fusionnés. | S | ❌ |
| EF-M05-14 | Mode hors ligne : la saisie d'un encaissement en espèces sans réseau est mise en file locale, puis synchronisée **sans doublon** au retour du réseau. La file est consultable et annulable. | S | ⚠️ (doublons possibles, file invisible) |

#### M05-C Reçus

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M05-20 | Chaque contribution confirmée produit un **reçu PDF** numéroté `REC-AAAA-XXXXXXXX`. Il mentionne : communauté, payeur, matricule, rubrique, période, montant dû, frais, total débité, mode, référence, collecteur, date de confirmation, statut. | M | ✅ |
| EF-M05-21 | Le reçu est envoyé automatiquement (WhatsApp avec document, sinon texte et lien ; e-mail si disponible) selon `AUTO_SEND_RECEIPT_WHATSAPP`. | M | ✅ |
| EF-M05-22 | Le lien de reçu partagé DOIT être **signé et temporaire** (30 jours) ; le reçu reste téléchargeable à tout moment depuis l'application par son propriétaire et le staff habilité. | S | ⚠️ (URL publique permanente) |
| EF-M05-23 | Un reçu annulé (litige résolu « ANNULE », remboursement) porte la mention « ANNULÉ ». Un reçu ne doit jamais être réémis à l'identique avec un statut différent. | S | 🟡 |

### M06 — Validation, refus, litiges

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M06-01 | File « À valider » : déclarations d'espèces et virements en attente, dans le périmètre de l'utilisateur, triés par ancienneté, paginés, chacun avec son montant et son payeur. | M | 🟡 (inclut les paiements électroniques ; pas de périmètre pour les rôles ≥ 3) |
| EF-M06-02 | **Confirmer** une déclaration : action explicite, avec récapitulatif « Je confirme avoir reçu X FCFA de Y pour Z ». Elle est **atomique** (une seule confirmation même en cas de double clic). Un reçu est produit et le payeur notifié. | M | ⚠️ (pas de récapitulatif ; écriture non conditionnelle) |
| EF-M06-03 | **Refuser** une déclaration (« je n'ai pas reçu cet argent ») avec motif de 10 à 500 caractères ; la déclaration passe à `ANNULE`. Le refus est distinct du litige. | M | ❌ |
| EF-M06-04 | **Litige** : ouvert par un superviseur (niveau ≥ 3) sur une contribution en attente ou confirmée **dont les fonds n'ont pas encore été transférés ni déposés**, avec motif. Les fonds sont bloqués. | M | ⚠️ (ouvert au niveau 2, sans contrôle d'état ni de fonds) |
| EF-M06-05 | **Résolution** : « Confirmer » (réapplique les droits de confirmation, RG-15) ou « Annuler ». Si un paiement électronique est annulé, une **procédure de remboursement** est ouverte (M16). | M | 🟡 |
| EF-M06-06 | **Autorisation de substitution** : un ADMIN peut autoriser nominativement un trésorier à confirmer **une** contribution précise attribuée à un autre collecteur, avec date d'expiration et motif. L'autorisation est consommée à l'usage, révocable et auditée (`CONFIRM_OVERRIDE`). | S | ✅ (lot 4.4) |
| EF-M06-07 | Relance automatique du collecteur pour toute déclaration en attente depuis plus de `reminderDelayDays` jours, et alerte du trésorier au-delà du double de ce délai. | S | ✅ (lot 4.3) |

**CA-M06-A** — *Étant donné* une contribution MTN MoMo en attente attribuée au collecteur A, *quand* A appelle « Confirmer », *alors* l'API répond 403 `ACTION_FORBIDDEN` et la contribution reste inchangée.
**CA-M06-B** — *Étant donné* deux appels simultanés « Confirmer » sur la même déclaration, *alors* un seul réussit, l'autre reçoit 409, un seul reçu et une seule notification sont émis.

### M07 — Trésorerie : chaîne de détention des fonds

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M07-01 | Toute contribution confirmée a une **localisation** (RG-20). Les transitions autorisées sont celles de RG-21 ; **aucune autre** n'est possible, même pour l'ADMIN, sans écriture corrective tracée. | M | ⚠️ (`/collecteurs/transfer` et `/claim` permettent des transitions arbitraires) |
| EF-M07-02 | **Transférer** : le détenteur choisit ses contributions `CHEZ_COLLECTEUR`, un destinataire (collecteur, responsable, trésorier) et un moyen (main propre, dépôt MTN, dépôt Orange, autre) ; note facultative. Les fonds passent `EN_TRANSIT` et le destinataire est notifié. | M | ✅ |
| EF-M07-03 | **Réceptionner** : seul le destinataire confirme (la localisation passe chez lui et un bordereau PDF est produit) ou refuse avec motif (retour à l'expéditeur). L'expéditeur peut annuler tant que le transfert est en attente. Ces trois actions sont **mutuellement exclusives et atomiques**. | M | ⚠️ (concurrence possible ; le collecteur destinataire n'a pas d'écran, UX-02) |
| EF-M07-04 | **Demande de remise** : le trésorier demande à un collecteur identifié de lui remettre ses fonds. La demande n'a aucun effet comptable et produit une notification ciblée. | S | ✅ (lot 4.3) |
| EF-M07-05 | **Dépôt bancaire** (trésorier) : sélection de contributions `REMIS_TRESORIER` ou `EN_CAISSE`, référence et date du bordereau, pièce jointe (photo du bordereau). Atomique. | M | 🟡 (pas de pièce jointe ni d'atomicité) |
| EF-M07-06 | **Fonds électroniques** : les montants Mobile Money et carte sont crédités sur le compte du prestataire (wallet Yelii, compte CinetPay). Ils DOIVENT apparaître dans une localisation distincte `COMPTE_PRESTATAIRE` (🆕), puis passer `EN_BANQUE` lors d'un **reversement** enregistré, avec rapprochement des frais et du net. | S | ⚠️ (classés `REMIS_TRESORIER`, ce qui fausse la caisse physique) |
| EF-M07-07 | Vue consolidée : total confirmé, et pour chaque localisation montant et nombre. Chaque carte ouvre la liste filtrée correspondante. Un tableau par collecteur donne montant détenu, ancienneté la plus haute, dépassement de `maxFundsRetentionDays` et action « demander une remise ». | M | 🟡 |
| EF-M07-08 | Rappels automatiques : transfert non traité après `transferPendingReminderHours` → rappel au destinataire ; après `transferAlertTresorierHours` → alerte au trésorier. | S | ✅ (lot 4.3) |
| EF-M07-09 | **Clôture mensuelle** : le trésorier valide la position de fin de mois (caisse comptée, banque rapprochée), avec écart justifié. Un PDF de clôture est produit et la période est verrouillée : aucune modification rétroactive sans écriture corrective. | S | ❌ 🆕 |

### M08 — Collectes publiques

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M08-01 | Le trésorier (ou l'admin) crée une collecte : titre, description, rubrique existante ouverte ou nouvelle rubrique `PONCTUELLE` créée automatiquement, montant minimum, montants suggérés (≤ 6), champs personnalisés (≤ 12 ; texte, nombre, liste, date, case à cocher), lien public `/collecte/<slug>`. | M | ✅ |
| EF-M08-02 | La page publique affiche **le titre, la description, l'organisateur, le badge « Urgent »** le cas échéant, les montants suggérés, et des étapes libellées. Elle n'affiche jamais de total collecté ni le nom d'autres donateurs. | M | ⚠️ (titre et urgence non affichés, étapes non libellées, UX-04) |
| EF-M08-03 | Brouillon reprenable pendant 7 jours (jeton secret, haché en base). | S | ✅ |
| EF-M08-04 | Paiement Mobile Money ou carte, avec **protection contre le double débit** (réservation atomique du brouillon avant l'appel au fournisseur). | M | ⚠️ (V-12) |
| EF-M08-05 | Le donateur reçoit son reçu par WhatsApp ou e-mail ; le back-office voit les contributions de la collecte avec le nom du donateur (jamais « Membre inconnu ») et exporte en Excel. | M | 🟡 (nom non transmis dans les listes générales) |
| EF-M08-06 | Un contributeur externe déjà connu (même téléphone) n'est **pas écrasé** par une nouvelle saisie : on ajoute un alias ou on conserve le premier nom. | S | ⚠️ |
| EF-M08-07 | Désactiver le lien sans supprimer la rubrique ; signaler ou retirer l'urgence (avec notification interne). | M | ✅ |
| EF-M08-08 | Partage en un geste (WhatsApp, copie du lien, QR code imprimable). | S | 🟡 (copie du lien seulement) |

### M09 — Notifications

Voir la matrice détaillée au §8.

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M09-01 | Centre de notifications in-app (non lues, tout marquer comme lu, clic qui ouvre l'écran ciblé grâce à une **URL**). | M | 🟡 (ciblage sans URL, UX-01) |
| EF-M09-02 | Notifications push web (PWA) avec permission demandée **en contexte** (après un premier paiement ou une première déclaration), jamais par un bandeau permanent. | S | ⚠️ (bandeau permanent, UX-06) |
| EF-M09-03 | WhatsApp (360dialog) pour les confirmations, reçus et OTP, avec **modèles validés par Meta** ; repli SMS (Twilio) pour l'OTP ; e-mail en complément. Interrupteurs par canal (`WHATSAPP_ENABLED`…). | M | ✅ (modèles Meta à valider) |
| EF-M09-04 | Diffusion (broadcast) par un responsable : titre, message, cible (rôle ou liste), avec push. | S | ✅ |
| EF-M09-05 | Relevé mensuel automatique de chaque membre actif ayant contribué, le 1er du mois à 08:00 (heure de Douala). | S | ✅ |
| EF-M09-06 | Préférences de notification par utilisateur (canaux, sons, heures calmes). | C | 🟡 (son seulement) |

### M10 — Tableaux de bord, statistiques, rapports, exports

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M10-01 | **Accueil par rôle** (mobile-first) :<br>• Membre → reste à payer et 3 derniers paiements ;<br>• Collecteur → fonds détenus, « À valider (n) », « Transferts à recevoir (n) » ;<br>• Trésorier et responsables → liste « À traiter aujourd'hui » (validations, transferts, litiges, paiements bloqués), puis 4 indicateurs en grille 2×2 avec tendance par rapport au mois précédent ;<br>• Admin → santé du système. | M | 🟡 |
| EF-M10-02 | Statistiques filtrables par mois et par année : collecte mensuelle, statut des contributions, répartition par moyen, taux de recouvrement par rubrique. | S | ✅ |
| EF-M10-03 | Rapport financier annuel PDF : synthèse, rubriques, top contributeurs, moyens de paiement. | S | ✅ (à sécuriser, V-06) |
| EF-M10-04 | Exports Excel des membres, rubriques, contributions (filtrés) et collectes. Ils sont générés **côté serveur** et ne sont pas limités à 500 lignes. | S | ✅ (lot 4.6) |
| EF-M10-05 | Tous les indicateurs sont calculés **côté serveur** sur l'ensemble du périmètre autorisé, jamais sur une page chargée. | M | ⚠️ (calculs sur la page dans plusieurs vues) |

### M11 — GED des commissions

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M11-01 | Dépôt d'un document (PDF, image, Word, Excel ; 20 Mo maximum) rattaché à une commission et à un type ; le type définit la durée de conservation. | S | ✅ (type réel du fichier non vérifié) |
| EF-M11-02 | Circuit : brouillon → soumis → approuvé ou rejeté (motif) → archivé. Suppression réservée au niveau 3 et plus, avec audit. | S | ✅ |
| EF-M11-03 | Consultation réservée aux niveaux ≥ 3 (ou aux membres de la commission 🆕) ; les membres ne voient que les documents **approuvés** et publiés. | M | ⚠️ (tout est lisible au niveau 1) |
| EF-M11-04 | Purge ou archivage à l'échéance de conservation (`expiresAt`), avec notification préalable. | C | ❌ |
| EF-M11-05 | Versionnement d'un document (le champ `version` existe). | C | ❌ |

### M12 — Prestations (groupe Génie)

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M12-01 | Créer une prestation : référence automatique, titre, commanditaire et téléphone, tarif de base, rabais (montant → %), tarif final, date, lieu, taux de commission (35 % par défaut). | S | ✅ |
| EF-M12-02 | Enregistrer les dépenses (« cours ») avec justificatif, et les entrées avec mode et référence. Recalcul automatique : total des cours, total des entrées, acompte, solde, passage `EN_COURS`. | S | ✅ (justificatif sous forme de texte, sans fichier) |
| EF-M12-03 | Clôturer les entrées lorsque les entrées ≥ tarif final, puis verser la commission (trésorier) : `round((tarifFinal − totalCours) × taux)`. | S | ✅ |
| EF-M12-04 | Les entrées et la commission alimentent la trésorerie : localisation et lien vers une rubrique dédiée. | C | ❌ 🆕 |

### M13 — Journal d'audit et observabilité

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M13-01 | Toute action sensible est journalisée avec : auteur réel (y compris sous impersonation), action, entité, détails, IP, agent utilisateur, horodatage serveur. Le journal est **inaltérable** (aucune route de modification ou de suppression ; rôle SQL en ajout seul 🆕). | M | 🟡 (plusieurs actions non auditées ; double mécanisme `audit()` / `auditLog.create`) |
| EF-M13-02 | Consultation filtrée par rôle (voir la matrice §4) : action, entité, utilisateur, période, recherche. | M | ✅ |
| EF-M13-03 | Traçabilité d'une contribution : chronologie complète (création, confirmation, transfert, réception, dépôt, litige). | M | ✅ |
| EF-M13-04 | Observabilité administrateur : présence en ligne, sessions, temps actif par page, actions par utilisateur, avec rétention limitée. | C | ✅ (performance à revoir) |

### M14 — Paramètres et panneau développeur

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M14-01 | Paramètres métier (ADMIN) : identité (nom, verset), ratios, revalorisation, seuils (inactivité, relance, rétention des fonds, rappels de transfert). **Chaque paramètre affiché DOIT avoir un effet** ; sinon il est retiré de l'écran. | M | ⚠️ (5 paramètres sans effet) |
| EF-M14-02 | Panneau développeur : configuration à chaud (URL, clés, taux, interrupteurs), secrets masqués, révélation auditée et réauthentifiée 🆕, historique par clé, recalcul de l'URL du webhook, test de connexion Yelii. | M | ✅ |
| EF-M14-03 | **Mode maintenance** (`MAINTENANCE_MODE`, `MAINTENANCE_MESSAGE`) : bloque toutes les écritures sauf pour DEVELOPER, et affiche un bandeau. | S | ❌ (clés sans effet) |
| EF-M14-04 | Les interrupteurs déclarés (`FEATURE_OFFLINE_PWA`, `FEATURE_QUERY_BUILDER`, `FEATURE_PERCENT_DISTRIBUTION`, `LOG_LEVEL`) sont soit branchés, soit retirés. | S | ❌ |

### M15 — Application mobile (PWA) et hors ligne

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M15-01 | Installable (manifest complet, icône `maskable`), lancement plein écran, **mise à jour signalée** (« Nouvelle version disponible — Recharger »). | S | 🟡 |
| EF-M15-02 | **Chaque écran a une URL** ; le bouton « retour » d'Android revient à l'écran précédent ou ferme la feuille ouverte, jamais l'application ; un rafraîchissement conserve l'écran. | M | ⚠️ (preuve UX-01) |
| EF-M15-03 | Barre d'onglets inférieure par rôle (voir §9) avec badges. | M | 🟡 |
| EF-M15-04 | Page hors ligne explicite et file des saisies en attente (EF-M05-14). | S | 🟡 |

### M16 — Remboursements et annulations (🆕)

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M16-01 | Toute annulation d'une contribution **confirmée** passe par une demande de remboursement : motif, montant, moyen (espèces, Mobile Money sortant, virement), validée par le trésorier **et** un second rôle (ADMIN ou RESPONSABLE). | S | ❌ |
| EF-M16-02 | Le remboursement est une **écriture compensatoire** (montant négatif lié) ; la contribution d'origine n'est jamais modifiée silencieusement. | S | ❌ |
| EF-M16-03 | Trop-perçu : lorsqu'un prestataire confirme un montant supérieur au montant attendu, la différence est enregistrée comme don, comme avoir ou comme remboursement, selon la décision du trésorier. | C | ❌ |

### M17 — Données personnelles et droits des personnes (🆕)

Contexte réglementaire : **loi camerounaise n° 2024/017 du 23 décembre 2024 relative à la protection des données à caractère personnel, en vigueur depuis le 23 juin 2026**. Elle crée l'Autorité de protection des données à caractère personnel (APDP) et encadre les transferts hors du territoire (autorisation préalable). *Interprétation à valider par un juriste.*

| ID | Exigence | Prio. | Statut |
|---|---|---|---|
| EF-M17-01 | Mentions d'information (page de confidentialité) : finalités, bases, destinataires (Yelii, CinetPay, Meta/360dialog, Twilio, hébergeur), durées, droits, contact. | M | 🟡 (page présente, contenu à vérifier) |
| EF-M17-02 | Consentement explicite des contributeurs externes (case à cocher) avant l'enregistrement de leur téléphone. | M | ❌ |
| EF-M17-03 | Droit d'accès et de portabilité : le membre télécharge ses données (profil + contributions) depuis « Mon profil ». | S | ❌ |
| EF-M17-04 | Droit de rectification (profil) et d'effacement **compatible avec les obligations comptables** : anonymisation de l'identité après la durée légale, montants conservés. | S | ❌ |
| EF-M17-05 | Registre des traitements et des sous-traitants tenu par l'ADMIN (document `04_POLITIQUE_SECURITE_CONFORMITE.md`). | M | ❌ |

---

## 6. Règles de gestion

### 6.1 Montants et calculs

| ID | Règle |
|---|---|
| **RG-01** | Tous les montants sont des **entiers en francs CFA (XAF)**, strictement positifs, ≤ 2 147 483 647. Aucune décimale n'est stockée. |
| **RG-02** | Une contribution porte sur **une** rubrique **ouverte** et un payeur : **soit** un membre actif, **soit** un contributeur externe, jamais les deux (XOR), sauf « remise groupée » (EF-M05-12). |
| **RG-03** | **Montant dû** = `amountTravailleur` / `amountEtudiant` / `amountCouple` de la rubrique selon le profil du membre. S'il est vide, la rubrique est **libre** et le montant dû est indéfini. |
| **RG-04** | **Reste à payer** = max(0, montant dû − Σ montants `CONFIRME` du membre sur la rubrique). Les montants en attente sont affichés à part (« dont X en attente de confirmation »). |
| **RG-05** | **Commission Mobile Money** (supportée par le payeur) : `totalÀPayer = ⌈ montantDû / (1 − taux) ⌉`, `frais = totalÀPayer − montantDû`. Le taux est `YELII_COMMISSION_RATE` (défaut 0,025), dans l'intervalle [0 ; 1[. Exemple : 5 000 → 5 129 (frais 129). Formule unique : `packages/shared/src/payment-calculations.ts`. |
| **RG-06** | **Répartition de la commission d'un lot** au prorata des lignes, arrondi entier ; le reliquat est attribué aux plus grands restes. Σ des parts = commission totale. |
| **RG-07** | **Carte** : total multiple de 5 FCFA, devise XAF, aucune commission ajoutée au payeur (*à confirmer par le Bureau : qui supporte les frais CinetPay ?*). |
| **RG-08** | **Collecte publique** : montant ≥ `montantMin` lorsqu'il est défini. |
| **RG-09** | **Prestation** : `tarifFinal = max(0, tarifBase − rabais)` ; `rabais% = rabais / tarifBase` ; `solde = max(0, tarifFinal − ΣEntrées)` ; `acompte = min(ΣEntrées, tarifFinal)` ; `commission = round((tarifFinal − ΣCours) × taux%)`. |

### 6.2 Paiements électroniques

| ID | Règle |
|---|---|
| **RG-10** | Un paiement électronique n'est **confirmé que par le prestataire** : webhook signé et vérifié, ou interrogation du statut côté serveur (polling client toutes les 5 s, réconciliation toutes les 10 min pour les opérations de plus de 15 min). Le retour du navigateur n'est **jamais** une preuve. |
| **RG-11** | À la confirmation, le montant renvoyé par le prestataire DOIT égaler le montant attendu : pour Yelii le total majoré **du lot ou de la contribution** ; pour CinetPay le montant en XAF. En cas d'écart : pas de confirmation, alerte unique (dédupliquée de façon persistante) aux trésoriers, et passage en `LITIGE` après 24 h. |
| **RG-12** | Idempotence : le premier événement terminal gagne (`updateMany … WHERE statut = EN_ATTENTE_CONFIRMATION`) ; les suivants sont ignorés sans effet de bord (pas de second reçu, pas de seconde notification). |
| **RG-13** | Une contribution `MTN_MOMO`, `ORANGE_MONEY`, `YELII` ou `CARTE_VISA` **ne peut jamais être confirmée manuellement**. En cas de blocage, le trésorier demande une revérification au prestataire (« Revérifier » / relance du webhook) ; s'il échoue, il ouvre un litige. |

### 6.3 Validation et espèces

| ID | Règle |
|---|---|
| **RG-14** | Seul le **collecteur désigné** confirme ou refuse une déclaration d'espèces le concernant. Les responsables ne se substituent pas à lui. |
| **RG-15** | Substitution : ADMIN ou DEVELOPER (tracée `CONFIRM_OVERRIDE`) ; TRÉSORIER uniquement avec une **autorisation nominative** valide (EF-M06-06), consommée à l'usage. |
| **RG-16** | Encaissement direct : uniquement `ESPECES`. La contribution naît `CONFIRME`, `CHEZ_COLLECTEUR`, `confirmedById = collecteur`. |
| **RG-17** | Un litige ne peut porter que sur des fonds non transférés et non déposés. Au-delà, on passe par une écriture corrective ou un remboursement (M16). |
| **RG-18** | Toute transition de statut est **conditionnelle** à l'état lu (contrôle optimiste) ; un conflit renvoie 409. |

### 6.4 Chaîne des fonds

| ID | Règle |
|---|---|
| **RG-20** | Localisations : `CHEZ_COLLECTEUR`, `EN_TRANSIT`, `CHEZ_RESPONSABLE`, `REMIS_TRESORIER`, `EN_CAISSE`, `EN_BANQUE`, plus 🆕 `COMPTE_PRESTATAIRE` pour l'électronique. Une contribution non confirmée n'a **pas** de localisation comptable. |
| **RG-21** | Transitions permises : création → `CHEZ_COLLECTEUR` (espèces) ou `COMPTE_PRESTATAIRE` (électronique) ; `CHEZ_COLLECTEUR` → `EN_TRANSIT` (transfert) ; `EN_TRANSIT` → localisation du destinataire (réception) ou retour (refus, annulation) ; `CHEZ_RESPONSABLE` → `EN_TRANSIT` (transfert vers le trésorier) ; `REMIS_TRESORIER` → `EN_CAISSE` (comptage) ou `EN_BANQUE` (dépôt) ; `EN_CAISSE` → `EN_BANQUE` (dépôt) ; `COMPTE_PRESTATAIRE` → `EN_BANQUE` (reversement). **Aucune autre.** |
| **RG-22** | Localisation à la réception : TRÉSORIER, ADMIN, DEVELOPER → `REMIS_TRESORIER` ; RESPONSABLE, ADJOINT → `CHEZ_RESPONSABLE` ; COLLECTEUR → `CHEZ_COLLECTEUR`, le collecteur devenant **détenteur**. 🆕 séparer `collecteurId` (auteur, immuable) et `detenteurId` (détenteur courant). |
| **RG-23** | Une contribution appartient à **au plus un** transfert en attente ; deux transferts concurrents des mêmes fonds sont impossibles. |
| **RG-24** | Le dépôt bancaire est réservé au TRÉSORIER (et ADMIN/DEV) ; il exige une référence de bordereau unique par date, et pas de double dépôt. |
| **RG-25** | Rétention : des fonds `CHEZ_COLLECTEUR` depuis plus de `maxFundsRetentionDays` jours sont signalés « en retard » au collecteur et au trésorier. |

### 6.5 Statuts et cycles de vie
Voir le §7.

### 6.6 Délais et durées

| ID | Règle | Valeur |
|---|---|---|
| RG-30 | Validité d'un OTP | 5 min, 3 essais |
| RG-31 | Jeton d'accès / de rafraîchissement / impersonation | 15 min / 7 j (rotation) / 1 h |
| RG-32 | Brouillon de don public | 7 j, prolongé à chaque sauvegarde |
| RG-33 | Polling client d'un paiement | toutes les 5 s pendant 5 min maximum |
| RG-34 | Réconciliation des paiements | toutes les `RECONCILIATION_INTERVAL_MINUTES` (10) pour les opérations de plus de 15 min ; alerte au-delà de 1 h ; litige au-delà de 24 h (🆕) |
| RG-35 | Relevé mensuel | le 1er du mois, 08:00 (Africa/Douala) |
| RG-36 | Rétention de l'observabilité | `ACTIVITY_RETENTION_DAYS` (défaut : 90 j), purge quotidienne |

---

## 7. Cycles de vie (machines à états cibles)

### 7.1 Contribution — statut métier unique (🆕 fusion de `statut` et `paymentStatus`)

```
                    ┌──────────── (espèces, encaissement direct) ─────────────┐
                    │                                                         ▼
 [création] ──► EN_ATTENTE ──(prestataire: succès, montant OK)──► CONFIRMEE ──(litige)──► EN_LITIGE
     │               │  │                                         ▲   │                    │  │
     │               │  └─(collecteur désigné: confirme)──────────┘   │                    │  └─(résolution: confirmer)──► CONFIRMEE
     │               │                                                │                    └──(résolution: annuler)──► ANNULEE
     │               ├─(collecteur: refuse, motif)──────────────────► ANNULEE
     │               ├─(prestataire: échec/annulation)──────────────► ECHOUEE
     │               └─(init. incertaine)──► A_VERIFIER ──(réconciliation)──► CONFIRMEE | ECHOUEE | EN_LITIGE (>24 h)
     │
 CONFIRMEE ──(remboursement validé)──► REMBOURSEE (écriture compensatoire liée)
```
Sous-état fournisseur conservé à titre informatif : `INITIALISE`, `EN_COURS`, `REUSSI`, `ECHEC`.

### 7.2 Lot de paiement
`EN_ATTENTE` → `CONFIRME` (toutes les lignes confirmées atomiquement) | `ECHOUE` (toutes les lignes échouées). Aucune confirmation partielle.

### 7.3 Transfert de fonds
`EN_ATTENTE_VALIDATION` → `CONFIRME` (destinataire, bordereau) | `REFUSE` (destinataire, motif ≥ 10 caractères) | `ANNULE` (expéditeur). États terminaux immuables.

### 7.4 Rubrique
`OUVERTE` ⇄ `FERMEE` → `ARCHIVEE` (terminal, sauf réouverture par l'ADMIN avec audit).

### 7.5 Document GED
`BROUILLON` → `EN_ATTENTE` → `APPROUVE` | `REJETE` (→ `EN_ATTENTE` après correction) ; tout état non archivé → `ARCHIVE`.

### 7.6 Prestation
`EN_PREPARATION` → `EN_COURS` (premier cours ou première entrée) → `ENTREES_COMPLETES` (entrées ≥ tarif final) → `COMMISSION_VERSEE` → `CLOTURE`.

### 7.7 Brouillon de don
`ACTIF` → `CONVERTI` (à la réservation atomique, **avant** l'appel au prestataire) ; expiration à 7 j.

---

## 8. Matrice des notifications

| Événement | Destinataires | In-app | Push | WhatsApp | SMS | E-mail |
|---|---|---|---|---|---|---|
| OTP de connexion | Demandeur | — | — | ● | repli | — |
| Paiement électronique initié | Payeur | ● | — | ○ | — | — |
| Paiement confirmé + reçu | Payeur (membre ou externe) | ● (membre) | ● | ● (document) | — | ● |
| Paiement échoué | Payeur | ● | ● | ● | — | — |
| Déclaration d'espèces à confirmer | Collecteur désigné | ● | ● | ● | — | — |
| Déclaration refusée | Déclarant | ● | ● | ● | — | — |
| Déclaration en attente > `reminderDelayDays` | Collecteur, puis trésorier | ● | ● | ○ | — | — |
| Transfert à valider | Destinataire | ● | ● | ○ | — | — |
| Transfert confirmé / refusé | Expéditeur | ● | ● | — | — | — |
| Transfert en attente > seuils | Destinataire, puis trésorier | ● | ● | — | — | — |
| Fonds en retard de remise | Collecteur, trésorier | ● | ● | — | — | — |
| Montant incohérent / paiements bloqués | Trésoriers | ● | ● | — | — | ● |
| Litige ouvert / résolu | Collecteur, payeur, trésorier | ● | ● | ○ | — | — |
| Collecte publique créée / urgence modifiée | Staff ≥ 3 | ● | ● | — | — | — |
| Relevé mensuel | Membre | — | — | ● | — | ● |
| Compte créé / mot de passe réinitialisé | Utilisateur | — | — | ● | — | ● |
| Diffusion (broadcast) | Cible choisie | ● | ● | — | — | — |

● = obligatoire · ○ = optionnel (paramétrable). Tous les messages sont en français, sans données sensibles au-delà du nécessaire (montant, rubrique, prénom).

---

## 9. Parcours clés mobile-first

> Contraintes de conception : écran de 360 px, pouce, réseau 3G, Android d'entrée de gamme. Une URL par écran. Détails et formulaires en **feuille inférieure**. Action principale fixée en bas. Champs ≥ 16 px, cibles ≥ 44 px. Montants toujours accompagnés de la mention « dont frais ».

**Barre d'onglets par rôle :**

| Rôle | Onglets |
|---|---|
| Membre | Accueil · **Payer** · Historique · Profil |
| Collecteur | Accueil · **Encaisser** · À valider (n) · Mes fonds |
| Responsable / Trésorier | Accueil · Validations (n) · Fonds (n) · Membres · Plus |
| Admin / Dev | Accueil · Utilisateurs · Paramètres · Plus |

**P1 — Le membre paie sa cotisation par Mobile Money (≤ 60 s, ≤ 6 touchers)**
1. Accueil : la carte « Reste à payer : 4 500 FCFA — Contribution mensuelle » propose **Payer**.
2. Écran Montant : pré-rempli (modifiable), mention « dont frais 116 FCFA — total 4 616 FCFA ».
3. Écran Moyen : MTN ou Orange, numéro pré-rempli depuis le profil → **Valider**.
4. Attente : « Composez votre code sur votre téléphone », compte à rebours ; ne pas fermer (et si l'utilisateur ferme, la reprise reste possible).
5. Succès : reçu affiché, boutons « Télécharger » et « Partager », retour à l'accueil mis à jour.

**P2 — Le membre déclare des espèces remises au collecteur**
Payer → Espèces → choisir le collecteur (les plus récents en tête) → rubriques et montants → Déclarer → statut « En attente de confirmation par Pierre O. » visible dans l'historique.

**P3 — Le collecteur confirme une déclaration**
Notification « 2 000 FCFA de Jean A. à confirmer » → URL `/validations/<id>` → feuille récapitulative → **J'ai reçu 2 000 FCFA** (confirmation) ou **Je n'ai pas reçu** (motif).

**P4 — Le collecteur remet ses fonds au trésorier**
Mes fonds → sélectionner (tout sélectionné par défaut) → Remettre à… → moyen → Envoyer. Le trésorier reçoit la notification, puis **Réceptionner** (ou refuser) ; le bordereau est envoyé aux deux.

**P5 — Le trésorier dépose en banque**
Fonds → En caisse ou remis → sélectionner → Déposer → référence, date, photo du bordereau → Valider → localisation `EN_BANQUE`.

**P6 — Don d'une personne extérieure**
Lien WhatsApp → page avec titre, badge urgent et description → montant (boutons suggérés) → nom, téléphone (consentement) → MoMo → USSD → reçu WhatsApp.

---

## 10. Exigences non fonctionnelles

| ID | Domaine | Exigence vérifiable |
|---|---|---|
| ENF-01 | Performance mobile | En 3G simulée (1,6 Mbit/s, latence 300 ms, CPU ralenti 4×) : LCP de la connexion ≤ 2,5 s ; accueil membre exploitable ≤ 3,5 s ; JavaScript initial de l'accueil membre ≤ 250 kB compressés. Mesure Lighthouse CI à chaque version. |
| ENF-02 | Performance API | p95 ≤ 300 ms pour les lectures paginées et ≤ 800 ms pour les écritures, hors appels prestataires ; génération d'un PDF ≤ 3 s. |
| ENF-03 | Disponibilité | ≥ 99,5 % par mois (environ 3 h 40 d'indisponibilité au maximum) ; maintenance annoncée 48 h à l'avance. |
| ENF-04 | Sauvegarde | RPO ≤ 24 h (objectif 1 h avec archivage WAL) ; RTO ≤ 4 h ; copie hors site chiffrée ; **test de restauration mensuel** consigné. |
| ENF-05 | Sécurité | Conformité à `04_POLITIQUE_SECURITE_CONFORMITE.md` ; 0 vulnérabilité critique ou élevée dans les dépendances exécutées en production au moment d'une mise en production. |
| ENF-06 | Intégrité financière | Toute somme affichée est recalculable depuis les contributions ; Σ des localisations = total confirmé ; contrôle automatique quotidien. |
| ENF-07 | Traçabilité | 100 % des actions de la matrice §4 journalisées ; conservation du journal ≥ 10 ans (*à confirmer : durée comptable OHADA*). |
| ENF-08 | Accessibilité | WCAG 2.1 AA sur les parcours P1 à P6 : zoom autorisé, contraste ≥ 4,5:1, libellés associés, cibles ≥ 44 px, annonces `aria-live`. 0 erreur axe-core « serious » ou « critical ». |
| ENF-09 | Compatibilité | Android ≥ 9 (Chrome ≥ 2 dernières versions majeures), iOS ≥ 16 (Safari), écrans de 320 à 1440 px, PWA installée et navigateur. |
| ENF-10 | Langue | Interface, messages, PDF et notifications en **français**, orthographe et accents corrects ; format monétaire « 12 100 FCFA », dates JJ/MM/AAAA, fuseau Africa/Douala. |
| ENF-11 | Conformité | Loi n° 2024/017 (Cameroun) : registre, information, droits, sous-traitants, transferts hors territoire autorisés (voir doc 04). |
| ENF-12 | Exploitabilité | Journaux structurés (JSON) sans données sensibles, métriques, alertes ; procédures du runbook `05_RUNBOOK_EXPLOITATION.md`. |
| ENF-13 | Maintenabilité | Couverture ≥ 70 % des services financiers ; CI verte obligatoire ; schéma versionné par migrations. |
| ENF-14 | Scalabilité | 1 000 membres, 50 staff, 30 000 contributions par an sans dégradation ; architecture extensible à 10 fois ce volume. |

---

## 11. Données et conservation

| Donnée | Exemples | Sensibilité | Conservation proposée (*à valider*) |
|---|---|---|---|
| Identité membre | Nom, matricule, catégorie, groupe, profession, date de naissance | Personnelle | Durée d'adhésion + 3 ans, puis anonymisation |
| Coordonnées | Téléphone, WhatsApp, e-mail, adresse | Personnelle | Idem |
| Contributions | Montant, rubrique, mode, dates, collecteur | Financière | 10 ans (pièces comptables) |
| Contributeurs externes | Nom, téléphone, e-mail, réponses aux champs personnalisés | Personnelle | 10 ans pour la pièce ; identité anonymisée après 3 ans |
| Reçus et bordereaux PDF | Nom, téléphone, montants | Financière et personnelle | 10 ans |
| Authentification | Hash de mot de passe, sessions, OTP | Sécurité | Sessions : 7 j ; OTP : 24 h ; hash : durée du compte |
| Journal d'audit | Auteur, action, IP, agent utilisateur | Sécurité | 10 ans (IP : 1 an) |
| Observabilité | Présence, temps par page | Personnelle | 90 j |
| Secrets d'intégration | Clés Yelii, CinetPay… | Critique | Rotation au moins annuelle ; chiffrés au repos |

---

## 12. Écarts existant / cible et backlog priorisé

| Rang | Exigences | Sujet | Prio. | Effort |
|---|---|---|---|---|
| 1 | EF-M06-02, RG-13, §4 | Interdire la confirmation manuelle des paiements électroniques ; brancher `contribution-access.service` | M | S (≤ 2 j) |
| 2 | EF-M07-01/03, RG-21/23 | Supprimer `/claim` et `/collecteurs/transfer` arbitraires ; transitions atomiques | M | S |
| 3 | EF-M05-04, RG-11 | Confirmation des lots multi-rubriques (comparer au total du lot) + reprise des lots existants | M | M (3–5 j) |
| 4 | EF-M01-04/06, EF-M02-01/03 | Mots de passe aléatoires, changement forcé côté serveur, révocation des sessions | M | S |
| 5 | EF-M15-02, EF-M09-01 | Une URL par écran (App Router) | M | M |
| 6 | EF-M05-06, EF-M10-05 | Espace membre : reçus, détail, totaux serveur | M | M |
| 7 | UX-02 (EF-M07-03) | Écrans manquants du collecteur (« Rubriques », « Fonds à réceptionner ») | M | XS (½ j) |
| 8 | EF-M08-02/04 | Page publique complète, anti double débit | M | S |
| 9 | EF-M06-03/04/05 | Refus distinct, litiges réservés aux superviseurs, réouverture contrôlée | M | S |
| 10 | EF-M05-08, RG-10/34 | Initialisation incertaine réconciliable | M | M |
| 11 | EF-M17-01/02/05 | Conformité loi 2024/017 (information, consentement, registre) | M | S |
| 12 | EF-M07-06, RG-20 | Localisation `COMPTE_PRESTATAIRE` + reversements | S | M |
| 13 | EF-M05-01/13, UX-05/11 | Parcours payer en 3 écrans, « Encaisser » unique, onglets par rôle | S | M |
| 14 | EF-M06-06/07, EF-M07-04/08 | Autorisation de substitution, relances, demande de remise | S | M |
| 15 | EF-M14-01/03/04 | Paramètres et interrupteurs sans effet → branchés ou retirés ; mode maintenance | S | S |
| 16 | EF-M16 | Remboursements | S | L (≥ 1 sem.) |
| 17 | EF-M07-09 | Clôture mensuelle | S | M |
| 18 | EF-M04-02/03, EF-M03-07 | Ratios, reconduction, inactifs | C | S |
| 19 | EF-M10-04 | Exports côté serveur | S | S |
| 20 | EF-M11-03/04/05, EF-M12-04 | GED (droits, conservation, versions), prestations → trésorerie | C | M |

Tailles : XS < ½ j · S ≤ 2 j · M 3–5 j · L > 1 semaine (un développeur confirmé).

---

## 13. Recette fonctionnelle (critères globaux)

Une version est **acceptée** si et seulement si :
1. toutes les exigences **M** du périmètre de la version ont leurs critères d'acceptation passés (fiche de recette signée par le Trésorier et un Responsable) ;
2. les 6 parcours P1 à P6 sont exécutés sur **un Android réel** et **un iPhone réel**, sans blocage ;
3. la suite automatique (doc 06) est verte, dont les tests RBAC « rôle × action » ;
4. un contrôle de cohérence financière (ENF-06) sur la base de recette donne un écart de 0 ;
5. aucune anomalie bloquante ou majeure n'est ouverte.

*Fin du cahier des charges fonctionnel.*
