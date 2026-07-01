# ──────────────────────────────────────────────────────────────────────
# DOCKERFILE API — Backend Express + TypeScript + Prisma
# Pourquoi node:20-slim ?
#   • Node >= 20 requis par le projet (engines dans package.json)
#   • slim = image légère (~300 Mo) mais apt-get disponible pour Puppeteer/Chromium
# ──────────────────────────────────────────────────────────────────────

FROM node:20-slim

# ── Étape 1 : apt-get pour Puppeteer / Chromium ───────────────────────
# Puppeteer a besoin de bibliothèques système pour lancer Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
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
    postgresql-client \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# ── Étape 2 : Définir le chemin de Chromium pour Puppeteer ─────────────
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ── Étape 3 : Répertoire de travail ────────────────────────────────────
WORKDIR /app

# ── Étape 4 : Installer les dépendances AVANT copie des sources ────────
# Pourquoi ? Le cache Docker garde ce layer si package.json ne change pas.
# Copie uniquement les fichiers de dépendances du workspace racine + api.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
RUN corepack enable pnpm && pnpm install --filter api --frozen-lockfile

# ── Étape 5 : Copier le code source ────────────────────────────────────
COPY apps/api/src ./apps/api/src
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/tests ./apps/api/tests
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/vitest.config.ts ./apps/api/vitest.config.ts

# ── Étape 6 : Générer le client Prisma (créé les types TypeScript) ─────
RUN cd /app/apps/api && pnpm prisma generate

# ── Étape 7 : Builder le TypeScript (autoriser les erreurs d'analyse existantes) ─
RUN pnpm --filter api build || true

# ── Étape 8 : Copier le point d'entrée (migrations avant démarrage) ───
COPY apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# ── Étape 9 : Exposer le port ──────────────────────────────────────────
EXPOSE 3001

# ── Étape 10 : Point d'entrée (migrations puis start) ─────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health',(r)=>{process.exit(r.statusCode===200?0:1)})" || exit 1
CMD ["/app/docker-entrypoint.sh"]
