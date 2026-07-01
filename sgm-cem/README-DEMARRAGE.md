# 🚀 SGM-CEM — Guide de Démarrage

## ✅ Qu'est-ce qui a été corrigé?

### Problèmes résolus:

1. ✅ **Port 3001 occupé** → Arrêt des processus précédents
2. ✅ **Gestion des erreurs** → Middleware amélioré
3. ✅ **Authentification** → Meilleure gestion des tokens JWT
4. ✅ **Permissions** → Messages d'erreur plus clairs
5. ✅ **Secrets** → Validation en production
6. ✅ **Client Prisma** → Singleton pattern pour éviter les fuites mémoire
7. ✅ **Health check** → Endpoint pour tester la connexion DB

### Documents d'aide créés:

- 📄 **CORRECTIONS_APPLIQUEES.md** — Détail des corrections
- 📄 **ANALYSE_COMPLETE.md** — Analyse complète du code
- 📄 **README-DEMARRAGE.md** — Ce fichier

---

## 🔧 PRÉREQUIS

### Logiciels requis:

```bash
✓ Node.js >= 20
✓ pnpm (package manager)
✓ PostgreSQL (base de données)
✓ Git (optionnel)
```

### Installation:

```bash
# macOS (Homebrew)
brew install node postgresql

# Windows (Chocolatey)
choco install nodejs postgresql

# Linux (apt)
sudo apt install nodejs postgresql postgresql-contrib
```

---

## 📝 CONFIGURATION

### 1. Cloner/Accéder au projet

```bash
cd "c:\Users\devne\Documents\project\CF MELEN\sgm-cem"
```

### 2. Installer les dépendances

```bash
pnpm install
```

### 3. Configurer PostgreSQL

#### Démarrer PostgreSQL:

```bash
# Windows (Services)
# Aller dans Services > PostgreSQL > Démarrer

# macOS
brew services start postgresql

# Linux
sudo service postgresql start
```

#### Créer la base de données:

```bash
psql -U postgres -c "CREATE DATABASE sgm_cem;"
```

#### Vérifier la connexion:

```bash
psql -U postgres -d sgm_cem -c "SELECT 1;"
# Devrait afficher: ?column?
#           1
# (1 row)
```

### 4. Configurer les variables d'environnement

Créer/éditer `.env` à la racine du projet:

```bash
# ─── DATABASE ─────────────────────────────────
DATABASE_URL="postgresql://postgres:password@localhost:5432/sgm_cem"
REDIS_URL="redis://localhost:6379"

# ─── JWT ──────────────────────────────────────
JWT_SECRET="dev-secret-change-in-production-min-256-bits-sgm-cem"
REFRESH_TOKEN_SECRET="dev-refresh-secret-change-in-production"

# ─── APP ──────────────────────────────────────
NODE_ENV="development"
PORT="3001"
APP_URL="http://localhost:3000"
API_URL="http://localhost:3001"

# ─── GOOGLE OAUTH (optionnel) ──────────────────
GOOGLE_CLIENT_ID="766407493659-iaut0eilt77a6tcmdhm40ecs39ipfd10.apps.googleusercontent.com"
ADMIN_EMAIL="admin@cem-melen.cm"
ADMIN_PASSWORD="ChristEst!2026"

# Les autres variables (SMS, WhatsApp, etc.) peuvent rester vides pour le développement
```

### 5. Initialiser la base de données

```bash
# Créer les tables
cd apps/api
pnpm db:generate
pnpm db:migrate

# Remplir avec les données d'exemple
pnpm db:seed

# Optionnel: Afficher Prisma Studio
pnpm db:studio
```

---

## ▶️ DÉMARRAGE DU PROJET

### Option 1: Démarrer les deux applications à la fois

```bash
cd sgm-cem
pnpm dev
```

Cela démarre:

- 🌐 Web: http://localhost:3000
- 📡 API: http://localhost:3001

### Option 2: Démarrer séparément

**Terminal 1 - API:**

```bash
cd sgm-cem/apps/api
pnpm dev
# Devrait afficher:
# ✅ SGM-CEM API running on port 3001
# 🔗 Health check: http://localhost:3001/api/health
```

**Terminal 2 - Web:**

```bash
cd sgm-cem/apps/web
pnpm dev
# Devrait afficher:
# ▲ Next.js 15.1.6
# - Local:        http://localhost:3000
```

---

## 🧪 VÉRIFIER LE DÉMARRAGE

### 1. Tester l'API

```bash
# Health check (pas besoin d'authentification)
curl http://localhost:3001/api/health

# Devrait afficher quelque chose comme:
# {"status":"ok","timestamp":"2026-06-07T...","database":"connected"}
```

### 2. Accéder à l'interface web

Ouvrir dans un navigateur: http://localhost:3000

### 3. Se connecter

```
Email: admin@cem-melen.cm
Mot de passe: ChristEst!2026
```

---

## 📊 TESTER L'AUTHENTIFICATION

### Tester login API:

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@cem-melen.cm",
    "password": "ChristEst!2026"
  }'

# Réponse attendue:
# {
#   "success": true,
#   "data": {
#     "accessToken": "...",
#     "refreshToken": "...",
#     "user": { ... }
#   }
# }
```

---

## ⚠️ DÉPANNAGE

### Le serveur API ne démarre pas

**Erreur: ECONNREFUSED - Cannot connect to database**

```
✓ PostgreSQL est-il démarré?
✓ DATABASE_URL est-elle correcte?
✓ La base de données existe-elle?

# Vérifier:
psql -U postgres -d sgm_cem -c "SELECT 1;"
```

**Erreur: Port 3001 already in use**

```
# Trouver le processus:
lsof -i :3001 (macOS/Linux)
netstat -ano | findstr :3001 (Windows)

# Ou simplement:
pnpm dev  # Devrait arrêter les anciens processus
```

### Le web ne démarre pas

**Erreur: Port 3000 already in use**

```bash
# Même solution que ci-dessus
```

### Connexion échoue

**Erreur: Identifiants incorrects**

```bash
# Vérifier l'admin existe:
psql -U postgres -d sgm_cem
SELECT * FROM users WHERE email = 'admin@cem-melen.cm';

# Si absent, regénérer:
cd apps/api
pnpm db:seed
```

---

## 📚 DOCUMENTATION

- **API Routes**: Voir `apps/api/src/routes/`
- **Modèles de données**: Voir `apps/api/prisma/schema.prisma`
- **Composants web**: Voir `apps/web/src/components/`
- **Types TypeScript**: Voir `apps/web/src/types/index.ts`

---

## 🔒 SÉCURITÉ

### En production:

- [ ] Changer `JWT_SECRET` et `REFRESH_TOKEN_SECRET`
- [ ] Configurer des clés API réelles (Google, MTN, Orange)
- [ ] Mettre en place HTTPS
- [ ] Configurer CORS correctement
- [ ] Ajouter monitoring (Sentry)
- [ ] Configurer les logs

### Secrets à configurer:

```
GOOGLE_CLIENT_ID/SECRET
MTN_SUBSCRIPTION_KEY/API_USER/API_KEY
ORANGE_CLIENT_ID/SECRET
TWILIO_ACCOUNT_SID/AUTH_TOKEN
DIALOG360_API_KEY
AWS_ACCESS_KEY_ID/SECRET (pour GED)
```

---

## 📝 PROCHAINES ÉTAPES

1. ✅ Démarrer le projet
2. ✅ Tester l'authentification
3. □ Ajouter des utilisateurs
4. □ Créer des rubriques
5. □ Tester les paiements (intégrations SMS/WhatsApp/MoMo)
6. □ Ajouter des tests unitaires
7. □ Mettre en place le monitoring

---

## 🆘 BESOIN D'AIDE?

- 📖 Lire **ANALYSE_COMPLETE.md** pour l'architecture
- 📋 Lire **CORRECTIONS_APPLIQUEES.md** pour les fix
- 🔗 Consulter les docs:
  - Prisma: https://www.prisma.io/docs/
  - Next.js: https://nextjs.org/docs
  - Express: https://expressjs.com/

---

**Créé le**: 7 juin 2026  
**Dernière mise à jour**: 7 juin 2026  
**Status**: ✅ Prêt à l'emploi
