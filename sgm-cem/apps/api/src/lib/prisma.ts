import { PrismaClient } from "@prisma/client";

// Singleton pattern pour Prisma
let prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log:
        process.env.NODE_ENV === "development"
          ? [
              { emit: "event", level: "query" },
              { emit: "stdout", level: "error" },
              { emit: "stdout", level: "warn" },
            ]
          : [{ emit: "stdout", level: "error" }],
    });

    // Log queries in development
    if (process.env.NODE_ENV === "development") {
      // prisma.$on('query', (e) => {
      //   console.log(`Query: ${e.query}`)
      //   console.log(`Params: ${e.params}`)
      //   console.log(`Duration: ${e.duration}ms`)
      // })
    }
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
