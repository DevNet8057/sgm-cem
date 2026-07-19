# ──────────────────────────────────────────────────────────────────────
# GUIDE DE DÉPLOIEMENT — Render.com
#
# Ce document détaille le processus complet de déploiement de SGM-CEM
# sur Render.com, de zéro à une application fonctionnelle.
#
# ⚠️  Les Blueprints Render ne supportent PAS la construction depuis
# Dockerfiles. Ce guide utilise la création manuelle des services
# dans le dashboard Render — c'est plus fiable et plus simple.
# ──────────────────────────────────────────────────────────────────────

## 📋 Prérequis

1. **Compte Render** (https://render.com) — plan gratuit suffisant pour démarrer
2. **Repo GitHub** contenant le projet SGM-CEM poussé sur `main`
3. **Variables d'environnement** prêtes (voir §2)

---

## 🚀 Étape 1 — Créer les services manuellement

### 1.1 Créer la base PostgreSQL

1. Dashboard Render → **New** → **PostgreSQL**
2. Nom : `sgm-cem-db`
3. Plan : **Starter** (gratuit)
4. Database : `sgm_cem`
5. Région : `Oregon (US West)` ou la plus proche
6. Cliquer **Create Database**
7. **Noter l'URL de connexion** (Internal Database URL) — elle apparaît dans l'onglet **Info**

### 1.2 Créer le Redis

1. Dashboard Render → **New** → **Redis**
2. Nom : `sgm-cem-redis`
3. Plan : **Starter**
4. **Noter l'URL de connexion**

### 1.3 Créer le service API (Express)

1. Dashboard Render → **New** → **Web Service**
2. Connecter le repo GitHub
3. **Name** : `sgm-cem-api`
4. **Runtime** : `Docker`
5. **Root Directory** : `sgm-cem`
6. **Dockerfile Path** : `apps/api/Dockerfile`
7. **Docker Context** : `.` (racine du repo)
8. **Port** : `3001`
9. **Plan** : Starter ($7/mois) ou Free (veille après 15 min)
10. Cliquer **Create Web Service**

### 1.4 Créer le service Web (Next.js)

1. Dashboard Render → **New** → **Web Service**
2. Connecter le repo GitHub
3. **Name** : `sgm-cem-web`
4. **Runtime** : `Docker`
5. **Root Directory** : `sgm-cem`
6. **Dockerfile Path** : `apps/web/Dockerfile`
7. **Docker Context** : `.` (racine du repo)
8. **Port** : `3000`
9. **Plan** : Starter ($7/mois) ou Free
10. Cliquer **Create Web Service**

---

## ⚙️ Étape 2 — Configurer les Variables d'Environnement

### Pour `sgm-cem-api` (Web Service) :

Aller dans l'onglet **Environment** du service API :

```
NODE_ENV=production
PORT=3001
DATABASE_URL=<Internal Database URL de sgm-cem-db>
REDIS_URL=<Internal Redis URL de sgm-cem-redis>
JWT_SECRET=<générer un secret aléatoire, ex: openssl rand -hex 32>
REFRESH_TOKEN_SECRET=<générer un secret aléatoire>
CSRF_SECRET=<générer un secret aléatoire>
APP_URL=https://sgm-cem-web.onrender.com
API_URL=https://sgm-cem-api.onrender.com
```

> 💡 Pour générer des secrets : `openssl rand -hex 32`

### Pour `sgm-cem-web` (Web Service) :

**Variables runtime** (onglet Environment) :
```
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://sgm-cem-api.onrender.com/api
NEXT_PUBLIC_APP_URL=https://sgm-cem-web.onrender.com
```

**Docker Build Args** (onglet Settings → Build & Deploy → Docker Build Args) :
```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<votre Google OAuth Client ID>
```

> ⚠️ **IMPORTANT** : Les `NEXT_PUBLIC_*` sont **figés au build** Next.js.
> - Les variables **runtime** ci-dessus sont définies dans l'onglet *Environment*.
> - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` doit être ajouté comme **Docker Build Arg**
>   (Settings → Build & Deploy → Docker Build Args) car il est requis pendant
>   `next build` (le Dockerfile a un `ARG` pour le recevoir).
> - Si vous modifiez ces valeurs, faites **Clear build cache & deploy**.

### Variables optionnelles (pour `sgm-cem-api`) :

```
# Yelii (Mobile Money)
YELII_API_KEY=votre_clé
YELII_WEBHOOK_SECRET=votre_secret
YELII_BASE_URL=https://api.yelii.com

# CinetPay (Carte bancaire)
CINETPAY_API_KEY=votre_clé
CINETPAY_SITE_ID=votre_site_id

# Google OAuth
GOOGLE_CLIENT_ID=votre_client_id

# Twilio (SMS pour OTP)
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=votre_auth_token
TWILIO_FROM=+1xxxxxxxxxx

# SMTP (emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre_email@gmail.com
SMTP_PASS=votre_mot_de_passe_app
SMTP_FROM=votre_email@gmail.com

# Web Push
VAPID_PUBLIC_KEY=votre_clé_publique
VAPID_PRIVATE_KEY=votre_clé_privée
VAPID_SUBJECT=mailto:votre@email.com
```

---

## 🔧 Étape 3 — Configurer les URLs de Webhook

Après le premier déploiement (les URLs publique sont disponibles) :

### Yelii
- URL de callback : `https://sgm-cem-api.onrender.com/webhooks/yelii`

### CinetPay
- URL de notification : `https://sgm-cem-api.onrender.com/webhooks/cinetpay`
- URL de retour : `https://sgm-cem-web.onrender.com/payment/return`

---

## 🔐 Étape 4 — Premier démarrage

Le `docker-entrypoint.sh` gère automatiquement :
1. ✅ Attente de PostgreSQL (timeout 120s pour cold start managed)
2. ✅ `prisma db push` (synchronisation du schéma)
3. ✅ Seed si la base est vide (comptes admin + rubriques + config)
4. ✅ Démarrage du serveur Express

### Comptes par défaut

| Rôle | Email | Mot de passe |
|------|-------|-------------|
| Admin | `admin@cem-melen.cm` | `ChristEst!2026` |
| Trésorier | `tresorier@cem-melen.cm` | `ChristEst!2026` |
| Responsable | `responsable@cem-melen.cm` | `ChristEst!2026` |
| Adjoint | `adjoint@cem-melen.cm` | `ChristEst!2026` |
| Collecteur 1 | `collecteur.temple@cem-melen.cm` | `ChristEst!2026` |
| Collecteur 2 | `collecteur.biscuiterie@cem-melen.cm` | `ChristEst!2026` |

> ⚠️ **CHANGEZ LES MOTS DE PASSE** immédiatement après la première connexion !

---

## 📊 Étape 5 — Vérifier le déploiement

### Health checks
- API : `https://sgm-cem-api.onrender.com/api/health` → `{"status":"ok"}`
- Web : `https://sgm-cem-web.onrender.com/` → page de login

### Logs
- Chaque service → onglet **Logs** (vérifier l'absence d'erreurs)

### Base de données
- Service `sgm-cem-db` → onglet **Data** → explorer les tables

---

## 💰 Estimation des coûts

| Service | Plan Starter | Plan Free |
|---------|-------------|-----------|
| PostgreSQL | ~$7/mois | ~$0 (veille) |
| Redis | ~$7/mois | ~$0 (veille) |
| API | ~$7/mois | ~$0 (veille) |
| Web | ~$7/mois | ~$0 (veille) |
| **Total** | **~$28/mois** | **~$0** (cold starts) |

> 💡 Le plan **Free** met les services en veille après 15 min d'inactivité.
> Le premier accès après veille prend ~30-60s (cold start).

---

## 🔄 Déploiements futurs

### Déploiement automatique
Par défaut, Render redéploie à chaque push sur `main`.

### Déploiement manuel
Service → **Manual Deploy** → **Clear build cache & deploy**

### Rollback
Service → onglet **Events** → cliquer sur un déploiement antérieur → **Rollback**

---

## 🛠️ Dépannage

| Problème | Solution |
|----------|----------|
| API ne démarre pas | Vérifier les logs, surtout `DATABASE_URL` |
| CORS errors | Vérifier `APP_URL` dans les env vars API |
| WebSocket déconnecte | `NEXT_PUBLIC_API_URL` doit être l'URL API sans `/api` (le hook `useSocket` retire le suffixe) |
| Cold start lent | Passer au plan **Starter** (Always On) |
| Uploads perdus | Configurer Cloudflare R2 (voir §5.1 ci-dessous) |

---

## 📦 §5.1 — Stockage persistant avec Cloudflare R2

Sur Render, le filesystem est **éphémérique** : chaque redéploy détruit les uploads
(reçus, avatars, docs GED). **Cloudflare R2** (compatible S3) résout ce problème
avec un tier gratuit généreux (10 Go, 10 millions de lectures/mois).

### Configuration

1. Créer un compte Cloudflare → **R2** → **Create bucket** → nom : `sgm-cem-uploads`
2. **Manage R2 API Tokens** → **Create API Token** → permissions *Object Read & Write*
3. Copier immédiatement : **Access Key ID**, **Secret Access Key**
4. Noter l'**Account ID** (visible dans l'URL du dashboard ou la page R2 Overview)

### Variables d'environnement (service API sur Render)

```
S3_ACCESS_KEY_ID=<votre Access Key ID>
S3_SECRET_ACCESS_KEY=<votre Secret Access Key>
S3_BUCKET_NAME=sgm-cem-uploads
S3_REGION=auto
S3_ENDPOINT=https://<votre_account_id>.r2.cloudflarestorage.com
```

> ⚠️ **`forcePathStyle` est déjà activé** dans `storage.ts` quand un endpoint
> personnalisé est fourni — aucune modification de code n'est nécessaire.

### Vérification

Après le redéploy, vérifier via les logs API : le mode de stockage doit passer
de `local` à `S3` au démarrage.

---

## 📁 Fichiers créés/modifiés pour Render

| Fichier | Rôle |
|---------|------|
| `apps/api/docker-entrypoint.sh` | Détecte Docker local vs Render managed |
| `apps/web/src/lib/api.ts` | Utilise `NEXT_PUBLIC_API_URL` en prod |
| `apps/api/Dockerfile` | Nettoyé (plus de render-start.sh) |
| `DEPLOY_RENDER.md` | Ce guide |
