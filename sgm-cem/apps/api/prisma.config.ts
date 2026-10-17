// Configuration Prisma 7 : l'URL de la base n'est plus dans schema.prisma.
// process.env (et non env()) : `prisma generate` doit fonctionner sans base,
// notamment pendant la construction de l'image Docker.
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL,
    // Base jetable pour `prisma migrate dev` / `migrate diff --from-migrations` (poste de développement)
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
})
