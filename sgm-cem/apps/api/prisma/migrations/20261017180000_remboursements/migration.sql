-- Lot 4.1 : remboursements à double validation (M16), écritures compensatoires
-- CreateEnum
DO $$ BEGIN CREATE TYPE "RemboursementStatut" AS ENUM ('DEMANDE', 'VALIDE', 'EXECUTE', 'REJETE', 'ANNULE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "RemboursementMoyen" AS ENUM ('ESPECES', 'MOBILE_MONEY', 'VIREMENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "remboursements" (
    "id" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "rubriqueId" TEXT NOT NULL,
    "membreId" TEXT,
    "montant" INTEGER NOT NULL,
    "moyen" "RemboursementMoyen" NOT NULL,
    "motif" TEXT NOT NULL,
    "beneficiaire" TEXT,
    "statut" "RemboursementStatut" NOT NULL DEFAULT 'DEMANDE',
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedById" TEXT,
    "validatedByName" TEXT,
    "validatedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "executedById" TEXT,
    "executedByName" TEXT,
    "executedAt" TIMESTAMP(3),
    "sourceLocation" "LocalisationFonds",
    "reference" TEXT,
    "proofKey" TEXT,
    "proofBucket" TEXT,
    "proofMime" TEXT,
    "proofName" TEXT,
    "proofSize" INTEGER,

    CONSTRAINT "remboursements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "remboursements_contributionId_idx" ON "remboursements"("contributionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "remboursements_statut_idx" ON "remboursements"("statut");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "remboursements_rubriqueId_idx" ON "remboursements"("rubriqueId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "remboursements_executedAt_idx" ON "remboursements"("executedAt");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "remboursements" ADD CONSTRAINT "remboursements_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;


