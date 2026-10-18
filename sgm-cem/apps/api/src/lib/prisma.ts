import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { currentAuditMeta } from "./request-context";

// Prisma 7 : connexion via l'adaptateur PostgreSQL (pool `pg`). Un seul client
// pour toute l'API — chaque client ouvre sa propre réserve de connexions.
export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: process.env.NODE_ENV === "development"
      ? [{ emit: "stdout", level: "error" }, { emit: "stdout", level: "warn" }]
      : [{ emit: "stdout", level: "error" }],
  });
}

let prisma: PrismaClient | undefined;

// Journal d'audit : IP, navigateur et auteur réel (impersonation) complétés depuis
// la requête en cours quand l'appelant ne les donne pas — toutes les écritures,
// transactions comprises, passent par ce client.
function withAuditContext(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      auditLog: {
        create({ args, query }) {
          args.data = { ...currentAuditMeta(), ...stripUndefined(args.data) } as typeof args.data;
          return query(args);
        },
        createMany({ args, query }) {
          const meta = currentAuditMeta();
          const rows = Array.isArray(args.data) ? args.data : [args.data];
          args.data = rows.map((row) => ({ ...meta, ...stripUndefined(row) })) as typeof args.data;
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

function stripUndefined<T extends object>(data: T): T {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as T;
}

export function getPrisma(): PrismaClient {
  if (!prisma) prisma = withAuditContext(createPrismaClient());
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
