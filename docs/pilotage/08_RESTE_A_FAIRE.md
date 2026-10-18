# Reste à faire avant la mise en production — revue du 18/10/2026

**Branche** : `claude/ecstatic-gates-g8pt2c` · **Méthode** : revue ligne à ligne du code, puis démarrage complet de la branche dans Docker sur une base neuve.

Ce document liste ce qui manque encore, par ordre de priorité. Le détail exigence par exigence est dans la colonne « Statut » du [cahier des charges](../specifications/01_CAHIER_DES_CHARGES_FONCTIONNEL.md) (§5 et §14).

**Ce que veut dire « prêt »** : le code existe et passe les tests automatiques. Mais **aucun service externe n'a encore été appelé avec un vrai compte** : WhatsApp, SMS, e-mail, Google, Yelii et CinetPay. Un service « prêt » reste donc à valider en réel par l'association (§4).

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
- Aucune file d'attente : un envoi qui échoue est perdu. Il faut une file BullMQ avec nouvel essai.
- **Le membre n'est pas averti** quand on confirme, refuse ou met en litige un paiement en espèces ou un virement. Seuls les paiements électroniques le préviennent.
- Le reçu PDF part seulement pour les paiements électroniques.
- Le relevé mensuel compte « envoyé » même quand aucun canal n'a abouti.

### 2.5 Paiements
| Service | État | À compléter |
|---|---|---|
| Yelii (MTN MoMo, Orange Money) | ✅ Code complet : signature et anti-rejeu du webhook, réconciliation, protection contre le double paiement | Valider la signature d'un **vrai** webhook (calculée sur un JSON re-sérialisé) ; Orange Money échouait chez Yelii lors des essais ; taux de commission réglé à 2,5 % alors que 3 % a été constaté ; aucun test de la route webhook |
| CinetPay (carte) | ✅ Code complet, jamais testé de bout en bout | **Ajouter un délai d'expiration** aux appels ; données client figées (Yaoundé, 00000) ; compte marchand à ouvrir |
| Réconciliation | ✅ | Pas d'expiration : un paiement jamais finalisé reste « en cours » indéfiniment et bloque une nouvelle tentative du même montant |

**Réglages inutiles à retirer** (jamais lus par le code) : `MTN_*`, `ORANGE_*`, `CRON_SECRET`, `YELII_WEBHOOK_SECRET`.

### 2.6 Socle technique
- **Cache de configuration (bloquant).** Chaque processus lit la configuration une seule fois, à son démarrage. En production, le worker (réconciliation, relances, relevés) ne voit **aucune** modification faite dans le panneau développeur avant d'être redémarré. Il faut une relecture périodique ou une notification entre processus.
- **Réglages absents (bloquant).** Une clé vide dans le `.env` au premier démarrage n'est pas créée en base : 32 clés ignorées lors du démarrage vérifié. Le panneau répond ensuite 404 pour ces clés. Il faut soit les créer vides, soit documenter qu'elles passent obligatoirement par le `.env`.
- **Stockage (bloquant si S3).** Un seul espace de stockage sert à la fois les reçus et avatars (publics) et la GED et les preuves (privés). Il faut des espaces séparés ou des liens signés. Le lien d'un reçu est public et permanent (EF-M05-22).
- **Temps réel.** Un seul événement est émis, à tous les connectés. Les événements écoutés par l'écran ne sont jamais envoyés, et le worker n'émet rien.
- **Suivi d'erreurs.** Les erreurs des webhooks, des tâches planifiées et des envois ne remontent pas à Sentry. Environ 60 `console.*` échappent aux journaux structurés.
- **Fuseau horaire.** Fixer `TZ=Africa/Douala` sur l'API et le worker : les statistiques découpent aujourd'hui les mois en UTC.

---

## 3. Travaux classés par priorité

### Bloquant (avant toute mise en production)
1. **Argent** : une contribution **confirmée** mise en litige puis « annulée » ne sort pas du grand livre et ne peut plus être remboursée. Il faut soit l'interdire, soit passer par un remboursement, soit écrire une sortie. Le contrôle quotidien doit aussi détecter ce cas (EF-M06-05, EF-M16-01, ENF-06).
2. **Google** : vérifier `email_verified` (2.1).
3. **WhatsApp** : API Cloud v2 et modèles approuvés, dont dépendent la connexion par téléphone et les reçus (2.4).
4. **Configuration** : rafraîchir le cache entre l'API et le worker ; rendre réglables les clés absentes (2.6).
5. **Stockage** : séparer le public du privé si S3 est utilisé (2.6).
6. **Membres** : adresse, dates et notes perdues à la création (EF-M03-01) ; matricule `count()+1` (EF-M02-06).
7. **Conformité** : appliquer les durées annoncées sur la page de confidentialité (contributeurs externes à 3 ans, IP d'audit à 1 an, codes, sessions, brouillons et notifications expirés) ; ajouter les bases légales ; ne plus enregistrer le téléphone d'un brouillon avant le consentement.
8. **Totaux globaux** : ils sont renvoyés à tous les rôles, y compris membres et collecteurs (EF-M04-06).

### Important
9. Avertir le membre et lui envoyer son reçu après une confirmation manuelle (EF-M05-10, EF-M05-21, EF-M06-02).
10. File d'attente avec nouvel essai pour tous les envois ; état de livraison enregistré.
11. Connexion par téléphone : numéros au format international, limites séparées et stockées dans Redis, essais atomiques, purge des codes (2.2).
12. Audit complet : IP et navigateur sur toutes les écritures, auteur réel sous impersonation, 5 actions encore non auditées (EF-M13-01).
13. Délai d'expiration CinetPay ; expiration des paiements bloqués ; taux de commission Yelii à 3 %.
14. Mot de passe oublié sans coordonnées personnelles (2.3) ; mots de passe de 10 caractères avec liste noire ; verrouillage par compte.
15. Indicateurs encore calculés dans le navigateur ; accueils incomplets pour le collecteur, le trésorier et l'administrateur (EF-M10-01, EF-M10-05).
16. Contributeur externe dont le nom est écrasé à chaque don (EF-M08-06) ; file « À valider » sans pagination et mêlée aux paiements électroniques (EF-M06-01).
17. Suivi d'erreurs sur les webhooks, tâches et envois ; `TZ=Africa/Douala` ; compléter les `.env.example`.

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
