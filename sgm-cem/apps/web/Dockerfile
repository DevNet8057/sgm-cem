# ──────────────────────────────────────────────────────────────────────
# DOCKERFILE WEB — Frontend Next.js 15
# Pourquoi node:24-bookworm-slim ?
#   • Node 24 LTS (Node 20 en fin de vie depuis le 30/04/2026 ; Puppeteer 25 exige Node >= 22.12)
#   • bookworm figé : noms de paquets apt stables (trixie renomme libasound2…)
#   • Pour next build + next start en production
# ──────────────────────────────────────────────────────────────────────

# Empreinte épinglée le 17/10/2026 — mise à jour volontaire uniquement
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5


WORKDIR /app

# ── Variables NEXT_PUBLIC_* : figées AU BUILD par Next.js ──────────────
# Next.js remplace process.env.NEXT_PUBLIC_* dans le bundle client au
# moment de `next build` — les passer à l'exécution ne sert à rien.
# Elles arrivent via `build.args` du docker-compose.yml.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ARG API_PROXY_URL=""
ARG API_PROXY_HOST=""
ARG API_PROXY_PORT=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV API_PROXY_URL=$API_PROXY_URL
ENV API_PROXY_HOST=$API_PROXY_HOST
ENV API_PROXY_PORT=$API_PROXY_PORT

# ── Manifestes du workspace + package shared ───────────────────────────
# @sgm-cem/shared (workspace:*) est une dépendance du web : il doit être
# présent avant `pnpm install` (résolution + postinstall `build:shared`).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/shared/src ./packages/shared/src
COPY apps/web/package.json ./apps/web/package.json

# `--filter web...` = web ET ses dépendances workspace (@sgm-cem/shared).
RUN corepack enable pnpm && pnpm install --filter web... --frozen-lockfile

# ── Copier le code source ───────────────────────────────────────────────
COPY apps/web/public ./apps/web/public
COPY apps/web/src ./apps/web/src
COPY apps/web/next.config.ts ./apps/web/next.config.ts
COPY apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY apps/web/tailwind.config.ts ./apps/web/tailwind.config.ts
COPY apps/web/postcss.config.mjs ./apps/web/postcss.config.mjs
COPY apps/web/eslint.config.mjs ./apps/web/eslint.config.mjs

# ── Build Next.js (génère .next/static, .next/server, etc.) ───────────
RUN pnpm --filter web build

# ── Exposer le port Next.js ────────────────────────────────────────────
EXPOSE 3000

# ── Healthcheck — vérifie que Next.js répond bien ──────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000',(r)=>{process.exit(r.statusCode<500?0:1)})" || exit 1

# ── Lancer le serveur de production Next.js ────────────────────────────
# Serveur sans root : .next appartient à node (cache d'images écrit à l'exécution),
# démarrage direct de Next (pas de pnpm/corepack au lancement)
RUN chown -R node:node /app/apps/web/.next
USER node
WORKDIR /app/apps/web
CMD ["node_modules/.bin/next", "start"]

# Traçabilité de l'image (--build-arg GIT_SHA=… --build-arg VERSION=…), déclarée EN DERNIER :
# un ARG qui change à chaque commit invaliderait le cache de toutes les étapes suivantes
# (installation des dépendances comprise) et rallongerait chaque déploiement.
ARG GIT_SHA=dev
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/DevNet8057/sgm-cem" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.version="$VERSION"
