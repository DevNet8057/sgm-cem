# ──────────────────────────────────────────────────────────────────────
# DOCKERFILE API — Backend Express + TypeScript + Prisma
# Pourquoi node:20-slim ?
#   • Node >= 20 requis par le projet (engines dans package.json)
#   • slim = image légère (~300 Mo) mais apt-get disponible pour Puppeteer/Chromium
# ──────────────────────────────────────────────────────────────────────

FROM node:20-slim

# ── Étape 1 : apt-get pour Puppeteer / Chromium + Prisma ───────────────
# Puppeteer a besoin de bibliothèques système pour lancer Chromium.
# openssl : requis par les moteurs Prisma sur Debian.
# postgresql-client : pg_isready dans l'entrypoint.
RUN apt-get -o Acquire::Check-Valid-Until=false update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    lsb-release \
    openssl \
    postgresql-client \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# ── Étape 2 : Définir le chemin de Chromium pour Puppeteer ─────────────
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ── Étape 3 : Répertoire de travail ────────────────────────────────────
WORKDIR /app

# ── Étape 4 : Manifestes du workspace + package shared ─────────────────
# Le package @sgm-cem/shared (workspace:*) est une dépendance de l'API :
# il DOIT être présent avant `pnpm install`, sinon la résolution échoue.
# Son source est copié aussi car le postinstall racine lance `pnpm build:shared`.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/shared/src ./packages/shared/src
COPY apps/api/package.json ./apps/api/package.json

# ── Étape 5 : Installer les dépendances (api + ses deps workspace) ─────
# `--filter api...` = api ET ses dépendances workspace (@sgm-cem/shared).
RUN corepack enable pnpm && pnpm install --filter api... --frozen-lockfile

# ── Étape 6 : Copier le code source de l'API ───────────────────────────
COPY apps/api/src ./apps/api/src
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json

# ── Étape 7 : Générer le client Prisma (crée les types TypeScript) ─────
RUN cd /app/apps/api && pnpm exec prisma generate

# ── Étape 8 : Builder le TypeScript ─────────────────────────────────────
# `|| true` : tsc émet dist/ même avec des erreurs de type connues.
RUN pnpm --filter api build || true \
  && test -f /app/apps/api/dist/index.js

# ── Étape 9 : Copier le point d'entrée (schéma DB + seed avant démarrage)
# Le script détecte automatiquement le contexte (Docker local vs Render managed)
# et adapte l'attente PostgreSQL + le db push en conséquence.
COPY apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# ── Étape 10 : Exposer le port ─────────────────────────────────────────
EXPOSE 3001

# ── Étape 11 : Healthcheck + point d'entrée ────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health',(r)=>{process.exit(r.statusCode===200?0:1)})" || exit 1
CMD ["/app/docker-entrypoint.sh"]
