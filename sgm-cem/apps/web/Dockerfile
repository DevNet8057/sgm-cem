# ──────────────────────────────────────────────────────────────────────
# DOCKERFILE WEB — Frontend Next.js 15
# Pourquoi node:20-slim ?
#   • Node >= 20 requis
#   • Pour next build + next start en production
# ──────────────────────────────────────────────────────────────────────

FROM node:20-slim

WORKDIR /app

# ── Installer les dépendances (cache Docker) ───────────────────────────
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json

RUN corepack enable pnpm && pnpm install --filter web --frozen-lockfile

# ── Copier le code source ───────────────────────────────────────────────
COPY apps/web/public ./apps/web/public
COPY apps/web/src ./apps/web/src
COPY apps/web/next.config.ts ./apps/web/next.config.ts
COPY apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY apps/web/tailwind.config.ts ./apps/web/tailwind.config.ts
COPY apps/web/postcss.config.mjs ./apps/web/postcss.config.mjs

# ── Build Next.js (génère .next/static, .next/server, etc.) ───────────
RUN pnpm --filter web build

# ── Exposer le port Next.js ────────────────────────────────────────────
EXPOSE 3000

# ── Healthcheck — vérifie que Next.js répond bien ──────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000',(r)=>{process.exit(r.statusCode<500?0:1)})" || exit 1

# ── Lancer le serveur de production Next.js ────────────────────────────
CMD ["pnpm", "--filter", "web", "start"]
