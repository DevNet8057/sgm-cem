# Reste à faire avant la mise en production — revue du 18/10/2026

**Branche** : `claude/ecstatic-gates-g8pt2c` · **Méthode** : revue ligne à ligne du code, puis démarrage complet de la branche dans Docker sur une base neuve.

Ce document liste ce qui manque encore, par ordre de priorité. Le détail exigence par exigence est dans la colonne « Statut » du [cahier des charges](../specifications/01_CAHIER_DES_CHARGES_FONCTIONNEL.md) (§5 et §14).

**Ce que veut dire « prêt »** : le code existe et passe les tests automatiques. Mais **aucun service externe n'a encore été appelé avec un vrai compte** : WhatsApp, SMS, e-mail, Google, Yelii et CinetPay. Un service « prêt » reste donc à valider en réel par l'association (§4).

## 0. Avancement (mis à jour à chaque commit)

**Bloquants : 8 sur 8 faits** (18/10/2026, branche `claude/ecstatic-gates-g8pt2c`). Chaque correction a ses tests automatiques ; la suite complète de l'API passe (445 tests). Les services externes y sont **simulés** : rien n'a été envoyé ni payé pour de vrai.

| N° | Point | État | Commit | Reste à faire |
|---|---|---|---|---|
| 1 | Argent d'un litige annulé | ✅ | `ab5713a` | Ouvrir automatiquement un remboursement quand un paiement électronique est annulé (EF-M06-05) |
| 2 | Google : adresse vérifiée | ✅ | `3f271b5` | Essai avec un vrai compte Google ; déclarer le domaine dans Google Cloud |
| 3 | WhatsApp : API Cloud et modèles | ✅ code | `45dc9bf` | **Créer les modèles chez 360dialog et les faire valider par Meta**, puis saisir leurs noms dans le panneau développeur (`WHATSAPP_TEMPLATE_*`) ; essai réel |
| 4 | Configuration : cache API/worker, clés absentes | ✅ | `2ec5398` | — |
| 5 | Stockage public / privé | ✅ | `59734ec` | Créer un bucket privé (`S3_PRIVATE_BUCKET_NAME`) si S3 est utilisé ; lien de reçu signé et temporaire (EF-M05-22) |
| 6 | Membres : champs perdus, matricule | ✅ | `3a354c6` | — |
| 7 | Durées de conservation | ✅ | `cd347d1` | Faire valider les durées et les bases légales par l'avis juridique |
| 8 | Totaux globaux | ✅ | `faae6ba` | — |

**Important : 9 sur 9 faits** (20/10/2026). Suite complète de l'API : 502 tests ; audit des écrans (4 rôles, bureau et mobile) : 108 écrans sans défaut.

| N° | Point | État | Commit | Reste à faire |
|---|---|---|---|---|
| 9 | Membre averti et reçu envoyé après confirmation manuelle | ✅ | `8cc1146` | — |
| 10 | File des envois avec nouveaux essais et état de livraison | ✅ | `efd3eb1` | Essai réel WhatsApp / SMS / e-mail |
| 11 | Connexion par téléphone : E.164, limites Redis, essais atomiques | ✅ | `e821dcc` | Modèle WhatsApp du code à faire valider par Meta |
| 12 | Audit complet (IP, navigateur, auteur réel, 5 actions) | ✅ | `4c04fcc` | — |
| 13 | Délai CinetPay ; paiement bloqué qui n'empêche plus un nouvel essai | ✅ | `57c57b6` | **Taux Yelii laissé à 2,5 %** : à confirmer avec le contrat (réglable `YELII_COMMISSION_RATE`) |
| 14 | Mot de passe oublié sans coordonnées ; règles ; verrouillage par compte | ✅ | `2973da7` + 20/10 | Majuscule exigée ajoutée le 20/10 (EF-M01-05) ; réinitialisation en libre-service (🆕) à faire |
| 15 | Indicateurs côté serveur ; accueils collecteur, trésorier, administrateur | ✅ | `954b10a` | — |
| 16 | Contributeur externe non écrasé ; file « À valider » paginée | ✅ | `2be17d6` | — |
| 17 | Suivi d'erreurs (tâches, webhooks, envois) ; `TZ` ; `.env.example` | ✅ | `954b10a` | Renseigner `SENTRY_DSN` en production (facultatif) |

Les points « Confort » (§3) sont la suite.

---

## 1. Démarrage de la branche dans Docker (vérifié le 18/10/2026)

Les 5 services démarrent et passent leur contrôle de santé sur une base neuve : `postgres`, `redis`, `gotenberg`, `api`, `web`.

| Point vérifié | Résultat |
|---|---|
| Construction des images API et web (compilation TypeScript comprise) | ✅ |
| Migrations sur base neuve | ✅ Les 10 migrations sont appliquées par l'entrypoint |
| Seed de base et de démonstration | ✅ 77 contributions, 20 réglages créés |
| API lancée sans les droits root | ✅ Utilisateur `node` (uid 1000) |
| Parcours dans le navigateur (trésorier, mobile 360 px) | ✅ Accueil, Contributions, Fonds, Validations, Remboursements, Clôtures, Rapports, sans aucune erreur serveur |
| Reçu PDF rendu par le conteneur Gotenberg | ✅ 82 Ko |
| Export Excel produit par le serveur | ✅ |
| Contrôle du grand livre | ✅ **0 écart**, après une correction (voir ci-dessous) |

**Défaut trouvé et corrigé.** Sur une base neuve, les migrations passent avant le seed de démonstration. Les 66 contributions confirmées de démonstration n'avaient donc **pas de position de départ** dans le grand livre : le contrôle quotidien aurait alerté la trésorerie dès le premier jour. `prisma/seed.ts` inscrit désormais cette position (même écriture que la migration du grand livre). Résultat : 66 écarts avant la correction, 0 après.

**Adaptations propres à l'environnement de vérification** (aucun fichier du dépôt n'a été modifié) :
- l'environnement de vérification bloque les miroirs Debian. Le client PostgreSQL a donc été copié depuis l'image officielle `postgres:15-bookworm`, au lieu d'être installé par `apt` ;
- les PDF sont rendus par Gotenberg, comme en production, et non par le Chromium de l'image ;
- les adresses utilisent `localhost` au lieu de l'IP du poste de développement, codée en dur dans `docker-compose.yml` (`172.21.253.77`).

L'image API officielle (`apps/api/Dockerfile`, avec `apt` et Chromium) reste donc à construire une fois sur la machine de préproduction.

---

## 2. Intégrations externes : état et éléments à compléter

### 2.1 Connexion par Google
- **Fonctionne (code)** : bouton Google sur la page de connexion, jeton vérifié côté API, connexion seulement pour un compte qui existe déjà (jamais de création automatique).
- **À compléter**
  - **Bloquant** : vérifier `email_verified` (`apps/api/src/routes/auth.ts`). Sinon, un compte Google non vérifié portant l'adresse d'un administrateur pourrait ouvrir sa session.
  - Rattacher le compte par l'identifiant Google (`sub`), pas seulement par l'e-mail.
  - Ajouter des tests de `/auth/google` (avec un faux fournisseur).
  - Ajouter `GOOGLE_CLIENT_ID` à `deploy/.env.example`.
- **Réglages** : `GOOGLE_CLIENT_ID` (API). Le web le reçoit **au moment de la construction de l'image** (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`) : les deux valeurs doivent être identiques.
- **Compte réel** : déclarer le domaine dans les « Authorized JavaScript origins » de Google Cloud (c'est la cause du 403 actuel) et passer l'écran de consentement en mode Production.

### 2.2 Connexion par numéro de téléphone (code reçu)
- **Fonctionne (code)**
  - Code à 6 chiffres tiré au hasard, stocké haché, valable 5 min, 3 essais, 5 codes par heure et par numéro.
  - Réponse identique que le numéro existe ou non.
  - Envoi par WhatsApp, puis par SMS en secours.
- **À compléter**
  - **Bloquant** : le canal WhatsApp (voir 2.4). Sans modèle approuvé par Meta, le code n'est pas délivré.
  - Le secours SMS ne part que si WhatsApp échoue **immédiatement** : un échec signalé plus tard ne le déclenche pas.
  - Enregistrer les numéros au format international (+237…) et rendre `whatsappPhone` unique en base.
  - Séparer les limites « demande de code » et « vérification ». Aujourd'hui, une seule limite par adresse IP couvre les deux : derrière le réseau d'un opérateur mobile, beaucoup d'utilisateurs partagent la même IP et peuvent être bloqués ensemble. Conserver ces limites dans Redis.
  - Compter les essais de façon atomique.
  - Supprimer les codes expirés (tâche planifiée).
  - Tester l'expiration, les 3 essais et le rejeu.

### 2.3 Mot de passe oublié
- **Aujourd'hui** : pas de réinitialisation en libre-service. La réponse invite à contacter l'administrateur et **affiche le nom, l'e-mail et le téléphone du premier administrateur**.
- **À compléter** : afficher un contact générique réglable au lieu de coordonnées personnelles. Option : un vrai lien de réinitialisation (jeton à usage unique, expiration, envoi par e-mail ou par code).

### 2.4 Notifications
| Canal | Fournisseur | État | À compléter |
|---|---|---|---|
| Dans l'application | — | ✅ | Écrire l'état d'envoi (`statut`, `sentAt`) |
| Push navigateur | Web Push (VAPID) | ✅ Code complet, abonnements expirés purgés | Clés `VAPID_*` absentes des `.env.example` ; chaque notification remplace la précédente (même balise) ; pas de bouton « tester » ; à essayer sur Android et iPhone (application installée) |
| WhatsApp | 360dialog | 🟡 | **Bloquant** : adresse `waba.360dialog.io/v1`, probablement l'ancienne API (à passer sur la Cloud API v2) ; **aucun modèle Meta** (code de connexion, confirmation, relevé) ; pas de délai d'expiration, pas de nouvel essai, pas de suivi de livraison |
| SMS | Twilio | 🟡 | Relevé mensuel coupé à 160 caractères ; pas de nouvel essai ; pas de secours SMS pour le reçu ; identifiant d'expéditeur pour le Cameroun à enregistrer |
| E-mail | SMTP (nodemailer) | 🟡 | Sert seulement aux reçus ; pas de `requireTLS` ; adresse du destinataire écrite dans les journaux ; pas de bouton « tester » ; aucun test |

**Manques transversaux.**
- ~~Aucune file d'attente : un envoi qui échoue est perdu.~~ → corrigé (point 10, file des envois avec nouveaux essais).
- ~~**Le membre n'est pas averti** quand on confirme, refuse ou met en litige un paiement en espèces ou un virement.~~ → corrigé (point 9).
- ~~Le reçu PDF part seulement pour les paiements électroniques.~~ → corrigé (point 9).
- Le relevé mensuel compte « envoyé » même quand aucun canal n'a abouti.

### 2.5 Paiements
| Service | État | À compléter |
|---|---|---|
| Yelii (MTN MoMo, Orange Money) | ✅ Code complet : signature et anti-rejeu du webhook, réconciliation, protection contre le double paiement | Valider la signature d'un **vrai** webhook (calculée sur un JSON re-sérialisé) ; Orange Money échouait chez Yelii lors des essais ; taux de commission réglé à 2,5 % alors que 3 % a été constaté ; aucun test de la route webhook |
| CinetPay (carte) | ✅ Code complet, jamais testé de bout en bout | ~~Ajouter un délai d'expiration~~ (15 s, point 13) ; données client figées (Yaoundé, 00000) ; compte marchand à ouvrir |
| Réconciliation | ✅ | ~~Un paiement jamais finalisé bloque une nouvelle tentative~~ → corrigé (point 13 : au-delà de 30 min, nouvel essai possible ; signalé « bloqué » à l'accueil du trésorier) |

**Réglages inutiles à retirer** (jamais lus par le code) : `MTN_*`, `ORANGE_*`, `CRON_SECRET`, `YELII_WEBHOOK_SECRET`.

### 2.6 Socle technique
- ✅ *(corrigé, point 4)* **Cache de configuration (bloquant).** Chaque processus lit la configuration une seule fois, à son démarrage. En production, le worker (réconciliation, relances, relevés) ne voit **aucune** modification faite dans le panneau développeur avant d'être redémarré. Il faut une relecture périodique ou une notification entre processus.
- ✅ *(corrigé, point 4)* **Réglages absents (bloquant).** Une clé vide dans le `.env` au premier démarrage n'est pas créée en base : 32 clés ignorées lors du démarrage vérifié. Le panneau répond ensuite 404 pour ces clés. Il faut soit les créer vides, soit documenter qu'elles passent obligatoirement par le `.env`.
- ✅ *(corrigé, point 5 ; lien de reçu signé et temporaire encore à faire)* **Stockage (bloquant si S3).** Un seul espace de stockage sert à la fois les reçus et avatars (publics) et la GED et les preuves (privés). Il faut des espaces séparés ou des liens signés. Le lien d'un reçu est public et permanent (EF-M05-22).
- **Temps réel.** Un seul événement est émis, à tous les connectés. Les événements écoutés par l'écran ne sont jamais envoyés, et le worker n'émet rien.
- ✅ *(corrigé, point 17 : incidents enregistrés, Sentry si configuré, carte « Santé du système »)* **Suivi d'erreurs.** Les erreurs des webhooks, des tâches planifiées et des envois ne remontaient pas à Sentry. Environ 60 `console.*` échappent aux journaux structurés.
- ✅ *(corrigé, point 17)* **Fuseau horaire.** `TZ=Africa/Douala` fixé sur web, API et worker ; statistiques découpées à l'heure de Yaoundé.

---

## 3. Travaux classés par priorité

### Bloquant (avant toute mise en production)
1. ✅ *(fait, voir §0)* **Argent** : une contribution **confirmée** mise en litige puis « annulée » ne sort pas du grand livre et ne peut plus être remboursée. Il faut soit l'interdire, soit passer par un remboursement, soit écrire une sortie. Le contrôle quotidien doit aussi détecter ce cas (EF-M06-05, EF-M16-01, ENF-06).
2. ✅ *(fait)* **Google** : vérifier `email_verified` (2.1).
3. ✅ *(code fait ; modèles Meta à créer)* **WhatsApp** : API Cloud v2 et modèles approuvés, dont dépendent la connexion par téléphone et les reçus (2.4).
4. ✅ *(fait)* **Configuration** : rafraîchir le cache entre l'API et le worker ; rendre réglables les clés absentes (2.6).
5. ✅ *(fait)* **Stockage** : séparer le public du privé si S3 est utilisé (2.6).
6. ✅ *(fait)* **Membres** : adresse, dates et notes perdues à la création (EF-M03-01) ; matricule `count()+1` (EF-M02-06).
7. ✅ *(fait ; avis juridique à obtenir)* **Conformité** : appliquer les durées annoncées sur la page de confidentialité (contributeurs externes à 3 ans, IP d'audit à 1 an, codes, sessions, brouillons et notifications expirés) ; ajouter les bases légales ; ne plus enregistrer le téléphone d'un brouillon avant le consentement.
8. ✅ *(fait)* **Totaux globaux** : ils sont renvoyés à tous les rôles, y compris membres et collecteurs (EF-M04-06).

### Important
9. ✅ *(fait, voir §0)* Avertir le membre et lui envoyer son reçu après une confirmation manuelle (EF-M05-10, EF-M05-21, EF-M06-02).
10. ✅ *(fait, voir §0)* File d'attente avec nouvel essai pour tous les envois ; état de livraison enregistré.
11. ✅ *(fait, voir §0)* Connexion par téléphone : numéros au format international, limites séparées et stockées dans Redis, essais atomiques, purge des codes (2.2).
12. ✅ *(fait, voir §0)* Audit complet : IP et navigateur sur toutes les écritures, auteur réel sous impersonation, 5 actions encore non auditées (EF-M13-01).
13. ✅ *(fait, voir §0)* Délai d'expiration CinetPay ; expiration des paiements bloqués ; taux de commission Yelii à 3 %.
14. ✅ *(fait, voir §0)* Mot de passe oublié sans coordonnées personnelles (2.3) ; mots de passe de 10 caractères avec liste noire ; verrouillage par compte.
15. ✅ *(fait, voir §0)* Indicateurs encore calculés dans le navigateur ; accueils incomplets pour le collecteur, le trésorier et l'administrateur (EF-M10-01, EF-M10-05).
16. ✅ *(fait, voir §0)* Contributeur externe dont le nom est écrasé à chaque don (EF-M08-06) ; file « À valider » sans pagination et mêlée aux paiements électroniques (EF-M06-01).
17. ✅ *(fait, voir §0)* Suivi d'erreurs sur les webhooks, tâches et envois ; `TZ=Africa/Douala` ; compléter les `.env.example`.

### Confort
18. Application mobile : bandeau « Nouvelle version », touche retour qui ferme une feuille, badges des onglets, page hors ligne.
19. Fiche membre consolidée, suivi de rubrique (en attente, payeurs, taux), écran de diffusion, partage WhatsApp et QR code, mes appareils et sessions.
20. Boutons « tester » (SMTP, WhatsApp, SMS, push) dans le panneau développeur ; nettoyage des réglages inutiles ; trop-perçu (EF-M16-03) ; prestations vers la trésorerie (reporté par le Bureau).
21. Petits défauts : nom affiché dans la notification d'un transfert confirmé ou refusé ; textes sans accents (prestations, GED) ; versement de commission de prestation non conditionnel.

---

## 4. À valider avec de vrais comptes (association)

| Fournisseur | À obtenir ou vérifier |
|---|---|
| 360dialog / Meta | Compte, numéro dédié, version Cloud API, modèles approuvés (code de connexion, confirmation, relevé) |
| Twilio | Identifiant d'expéditeur pour le Cameroun ; livraison chez MTN et Orange ; coût |
| SMTP | Domaine d'envoi avec SPF, DKIM et DMARC |
| Google Cloud | Origines autorisées ; écran de consentement en mode Production |
| Yelii | Signature d'un vrai webhook, Orange Money, taux réel, URL de webhook de production |
| CinetPay | Compte marchand, clés, paiement carte de bout en bout |
| Push | Clés VAPID générées une fois et conservées ; essais sur Android et iPhone |
| Stockage S3/R2 | Espace privé et espace public séparés |
| Sentry / GlitchTip | DSN |

Restent aussi, hors code : révocation de l'ancienne clé Yelii, CI GitHub (facturation), avis juridique, hébergement et préproduction, test d'intrusion. Voir [AVANCEMENT](AVANCEMENT.md).
