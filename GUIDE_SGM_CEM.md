# GUIDE D'UTILISATION — SGM-CEM
## Système de Gestion du Ministère · Culte d'Enfants de Melen · EEC Yaoundé

---

## 1. ACCÈS & IDENTIFIANTS PAR DÉFAUT

### Compte Administrateur
| Champ          | Valeur                        |
|----------------|-------------------------------|
| Email          | `admin@cem-melen.cm`          |
| Mot de passe   | `ChristEst!2026`              |
| Rôle           | ADMIN (accès total)           |

> **Important :** Changez ce mot de passe immédiatement après la première connexion.

### Mot de passe temporaire (nouveaux comptes créés par l'admin)
```
CEM@2026!
```
Chaque utilisateur est forcé de changer son mot de passe à la première connexion.

### Règles du mot de passe personnel
- Minimum **8 caractères**
- Au moins **1 majuscule**
- Au moins **1 chiffre**
- Caractère spécial recommandé

---

## 2. CONNEXION

### Via Email + Mot de passe
1. Aller sur `http://localhost:3000`
2. Sélectionner l'onglet **Email**
3. Saisir l'adresse email et le mot de passe
4. Cliquer sur **Se connecter**

### Via Téléphone (OTP SMS/WhatsApp)
> Le numéro de téléphone doit être enregistré dans votre compte par l'administrateur.
1. Sélectionner l'onglet **Téléphone**
2. Saisir votre numéro Cameroun (format : 6XXXXXXXX)
3. Cliquer sur **Recevoir le code**
4. Un code à 6 chiffres est envoyé par WhatsApp (ou SMS en secours)
5. Saisir le code reçu → validité **5 minutes**, max **3 tentatives**

### Via Google
> Votre adresse Gmail doit correspondre à l'email enregistré dans votre compte.
1. Cliquer sur **Continuer avec Google**
2. Sélectionner votre compte Google
3. Si l'email n'est pas en base : message d'erreur → contacter l'administrateur

---

## 3. RÔLES ET NIVEAUX D'ACCÈS

| Rôle                  | Niveau | Ce qu'il peut faire                                       |
|-----------------------|--------|-----------------------------------------------------------|
| **ADMIN**             | 5      | Tout + Gestion utilisateurs + Paramètres système          |
| **TRESORIER**         | 4      | Finances complètes (contributions, litiges, collecteurs)  |
| **RESPONSABLE**       | 3      | Membres, GED, Prestations, Statistiques, Rapports         |
| **ADJOINT_RESPONSABLE** | 3    | Même accès que Responsable                                |
| **COLLECTEUR**        | 2      | Enregistrer paiements + confirmer ses fonds               |
| **MEMBRE**            | 1      | Voir ses propres contributions + Notifications             |

---

## 4. FLUX DE PAIEMENT — GUIDE COMPLET

### 4.1 Paiement en espèces (présentiel)

```
Donateur → saisit montant + rubrique → valide
         ↓
Collecteur reçoit notification WhatsApp + in-app
         ↓
Collecteur confirme la réception dans Validations
         ↓
Fonds localisés : CHEZ_COLLECTEUR (statut : CONFIRME)
         ↓
Trésorier transfère → CAISSE_PRINCIPALE ou BANQUE
         ↓
Membre reçoit notification de confirmation + WhatsApp
```

**Pour enregistrer un paiement espèces :**
1. Aller dans **Contributions** → bouton **Guidé** (stepper 3 étapes)
2. Étape 1 : Chercher le membre + sélectionner la rubrique
3. Étape 2 : Choisir **Espèces** → sélectionner le collecteur
4. Étape 3 : Vérifier le récapitulatif → **Confirmer**
5. Le collecteur désigné reçoit une notification immédiate

### 4.2 Paiement MTN MoMo

```
Utilisateur saisit montant + numéro MoMo → valide
         ↓
Demande USSD envoyée sur le téléphone MTN
         ↓
Utilisateur entre son code PIN MoMo sur son téléphone
         ↓
Webhook MTN confirme → contribution CONFIRME automatiquement
         ↓
Membre reçoit WhatsApp + reçu PDF
```

**Pour payer via MTN MoMo :**
1. Contributions → **Guidé**
2. Étape 2 : Sélectionner **MTN MoMo**
3. Saisir le numéro MoMo du payeur
4. Valider → une demande USSD arrive sur le téléphone
5. L'écran affiche « En attente de confirmation »
6. Confirmer sur le téléphone → statut mis à jour automatiquement

### 4.3 Paiement Orange Money
Même flux que MTN MoMo, avec le réseau Orange.

### 4.4 Transfert de fonds (Collecteur → Trésorier)

1. Aller dans **Fonds Collecteurs**
2. Sélectionner les contributions à transférer (case à cocher)
3. Choisir la destination : **Caisse principale** ou **Banque**
4. Cliquer sur **Transférer**
5. Un audit log est créé automatiquement

---

## 5. GESTION DES UTILISATEURS (ADMIN)

### Créer un compte
1. Menu **Utilisateurs** (sidebar)
2. Bouton **Créer un compte**
3. Remplir : Prénom, Nom, Email, Téléphone, Rôle
4. Un mot de passe temporaire est généré (`CEM@2026!` par défaut)
5. Le mot de passe est copié dans le presse-papiers → à communiquer à l'utilisateur
6. **L'utilisateur devra le changer à sa première connexion**

### Photo de profil (admin)
Dans la liste des utilisateurs → bouton photo → ou dans le formulaire de création.

### Réinitialiser un mot de passe
1. Icône 🔑 à côté de l'utilisateur
2. Saisir un nouveau mot de passe temporaire (ou laisser vide = `CEM@2026!`)
3. Toutes les sessions de l'utilisateur sont invalidées
4. L'utilisateur devra changer son mot de passe à la prochaine connexion

---

## 6. MON PROFIL (tous les utilisateurs)

Accessible via l'icône de profil dans la barre latérale.

- **Photo de profil** : glisser-déposer ou cliquer pour télécharger (max 5 Mo)
- **Informations** : Prénom, Nom, Téléphone, Numéro WhatsApp
- **Mot de passe** : Changement sécurisé avec barre de force
- Les notifications WhatsApp sont envoyées sur le numéro WhatsApp renseigné

---

## 7. NOTIFICATIONS

### Types de notifications
| Type         | Déclencheur                                          |
|--------------|------------------------------------------------------|
| CONTRIBUTION | Nouveau paiement à confirmer (collecteur)            |
| CONTRIBUTION | Paiement confirmé (membre)                           |
| VALIDATION   | Paiement en attente de validation                    |
| LITIGE       | Contribution passée en litige                        |
| SYSTEM       | Informations système, mises à jour                   |

### Canaux de notification
1. **In-app** : cloche dans la barre du haut (temps réel)
2. **WhatsApp** : envoyé sur le numéro WhatsApp du compte
3. **SMS** : en fallback si WhatsApp échoue
4. **Relevé mensuel** : envoyé une fois par mois sur WhatsApp

---

## 8. LITIGES ET RÉCLAMATIONS

### Signaler un litige (Validateur)
1. Dans **Validations** → bouton **Litige**
2. Saisir le motif (minimum 10 caractères)
3. La contribution passe en statut LITIGE
4. Une notification est envoyée au Trésorier

### Résoudre un litige (Trésorier/Admin)
1. Dans **Litiges** → choisir **Confirmer** ou **Annuler**
2. Saisir une note de résolution (optionnel)
3. La contribution est mise à jour + audit log créé

---

## 9. GAPS IDENTIFIÉS (non encore implémentés)

Les fonctionnalités suivantes sont planifiées mais pas encore disponibles :

| # | Fonctionnalité                         | Priorité  | Notes                                      |
|---|----------------------------------------|-----------|--------------------------------------------|
| 1 | **Mode offline collecteur** (IndexedDB) | HAUTE    | Sync auto au retour en ligne               |
| 2 | **Upload S3 réel pour GED**            | HAUTE     | Actuellement : formulaire de métadonnées   |
| 3 | **Portemonnaie in-app**                | FUTURE    | Argent circule uniquement via l'app        |
| 4 | **Web Push (notifications navigateur)**| MOYENNE  | VAPID configuré mais pas branché           |
| 5 | **Reçu PDF envoyé automatiquement**    | HAUTE     | Service receipt.ts créé, à brancher        |
| 6 | **Relevé mensuel automatique (cron)**  | MOYENNE  | Service prêt, planification manquante      |
| 7 | **Tests automatisés API**              | HAUTE     | Aucun test présent                         |
| 8 | **CI/CD GitHub Actions**               | MOYENNE  | Pipeline à créer                           |
| 9 | **Preuve de paiement (photo)**         | HAUTE     | Upload + association à un litige           |
| 10 | **Portefeuille temps réel WebSocket** | FUTURE   | Architecture pub/sub à concevoir           |

---

## 10. CONFIGURATION REQUISE

### Variables d'environnement obligatoires

```bash
# Base de données
DATABASE_URL="postgresql://user:pass@localhost:5432/sgm_cem"

# JWT
JWT_SECRET="secret-min-32-caracteres"
REFRESH_TOKEN_SECRET="autre-secret-min-32-caracteres"

# Paiements MTN MoMo
MTN_SUBSCRIPTION_KEY="votre-cle"
MTN_API_USER="uuid-dashboard-mtn"
MTN_API_KEY="votre-api-key"
MTN_ENVIRONMENT="sandbox"   # ou "production"
MTN_MOMO_BASE_URL="https://sandbox.momodeveloper.mtn.com"
MTN_WEBHOOK_SECRET="secret-signature-webhook"

# Paiements Orange Money
ORANGE_CLIENT_ID="votre-client-id"
ORANGE_CLIENT_SECRET="votre-secret"
ORANGE_MERCHANT_KEY="votre-merchant-key"

# WhatsApp 360Dialog
DIALOG360_API_KEY="votre-api-key-360dialog"

# SMS Twilio
TWILIO_ACCOUNT_SID="ACxxxxxxxxxx"
TWILIO_AUTH_TOKEN="votre-auth-token"
TWILIO_FROM="+12345678901"

# Google OAuth
GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"

# Application
APP_URL="http://localhost:3000"
API_URL="http://localhost:3001"
PORT="3001"
```

### Frontend (.env.local)
```bash
NEXT_PUBLIC_API_URL="http://localhost:3001/api"
NEXT_PUBLIC_GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
```

---

## 11. DÉMARRAGE RAPIDE

```bash
# Installer les dépendances
cd sgm-cem && pnpm install

# Configurer la base de données
cd apps/api
cp ../../.env.example .env
# Éditer .env avec vos valeurs
npx prisma db push
npx prisma db seed

# Lancer (frontend + backend simultanément)
cd ../..
pnpm dev
```

Accès : `http://localhost:3000`
API : `http://localhost:3001/api`

---

*SGM-CEM v4.1 · Culte d'Enfants de Melen · EEC Yaoundé*
*"La Marche Ensemble dans l'Unité" · Eph. 2:20*
