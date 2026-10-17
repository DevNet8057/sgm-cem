import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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

export function getPrisma(): PrismaClient {
  if (!prisma) prisma = createPrismaClient();
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
