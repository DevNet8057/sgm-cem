-- File des envois externes : chaque message WhatsApp/SMS ou e-mail est enregistré
-- avec son état, et réessayé par la tâche « envois-relance » en cas d'échec.
DO $$ BEGIN
  CREATE TYPE "EnvoiCanal" AS ENUM ('MESSAGE', 'EMAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "EnvoiStatut" AS ENUM ('EN_ATTENTE', 'EN_COURS', 'ENVOYE', 'ECHEC', 'NON_CONFIGURE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "envois" (
    "id" TEXT NOT NULL,
    "canal" "EnvoiCanal" NOT NULL,
    "objet" TEXT NOT NULL,
    "destinataire" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statut" "EnvoiStatut" NOT NULL DEFAULT 'EN_ATTENTE',
    "essais" INTEGER NOT NULL DEFAULT 0,
    "voie" TEXT,
    "derniereErreur" TEXT,
    "prochainEssai" TIMESTAMP(3),
    "expireLe" TIMESTAMP(3),
    "envoyeLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "envois_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "envois_statut_prochainEssai_idx" ON "envois"("statut", "prochainEssai");
CREATE INDEX IF NOT EXISTS "envois_createdAt_idx" ON "envois"("createdAt");
