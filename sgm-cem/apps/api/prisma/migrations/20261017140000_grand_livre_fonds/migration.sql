-- Grand livre des fonds (lot 3.3), détenteur courant, reçu de dépôt bancaire.
-- Idempotent : une base adoptée (ancien `db push`) possède déjà le schéma courant,
-- et chaque reprise de données peut être rejouée sans effet.

DO $$ BEGIN
  CREATE TYPE "FundMovementReason" AS ENUM ('CONFIRMATION', 'TRANSFERT_ENVOI', 'TRANSFERT_RECEPTION', 'TRANSFERT_REFUS', 'TRANSFERT_ANNULATION', 'DEPOT_BANCAIRE', 'REPRISE_INITIALE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "bank_deposits" ADD COLUMN IF NOT EXISTS "proofBucket" TEXT;
ALTER TABLE "bank_deposits" ADD COLUMN IF NOT EXISTS "proofKey" TEXT;
ALTER TABLE "bank_deposits" ADD COLUMN IF NOT EXISTS "proofMime" TEXT;
ALTER TABLE "bank_deposits" ADD COLUMN IF NOT EXISTS "proofName" TEXT;
ALTER TABLE "bank_deposits" ADD COLUMN IF NOT EXISTS "proofSize" INTEGER;

ALTER TABLE "contributions" ADD COLUMN IF NOT EXISTS "detenteurId" TEXT;

CREATE TABLE IF NOT EXISTS "fund_movements" (
    "id" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "fromLocation" "LocalisationFonds",
    "toLocation" "LocalisationFonds" NOT NULL,
    "holderFromId" TEXT,
    "holderToId" TEXT,
    "reason" "FundMovementReason" NOT NULL,
    "transferId" TEXT,
    "bankDepositId" TEXT,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fund_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fund_movements_contributionId_at_idx" ON "fund_movements"("contributionId", "at");
CREATE INDEX IF NOT EXISTS "fund_movements_at_idx" ON "fund_movements"("at");
CREATE INDEX IF NOT EXISTS "contributions_detenteurId_idx" ON "contributions"("detenteurId");

DO $$ BEGIN
  ALTER TABLE "contributions" ADD CONSTRAINT "contributions_detenteurId_fkey" FOREIGN KEY ("detenteurId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "fund_movements" ADD CONSTRAINT "fund_movements_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Reprise des données ─────────────────────────────────────────────────

-- 1. Décision du Bureau (17/10/2026) : un virement confirmé est chez le trésorier
--    (il restait « En transit » sans transfert, ni remis ni déposable).
UPDATE "contributions"
SET "localisationFonds" = 'REMIS_TRESORIER'
WHERE "statut" = 'CONFIRME' AND "modePaiement" = 'VIREMENT'
  AND "localisationFonds" = 'EN_TRANSIT' AND "transferId" IS NULL;

-- 2. Détenteur courant. Jusqu'ici, le collecteur était aussi le détenteur
--    (collecteurId réécrit à la réception par un collecteur).
UPDATE "contributions"
SET "detenteurId" = "collecteurId"
WHERE "detenteurId" IS NULL AND "statut" = 'CONFIRME'
  AND "localisationFonds" IN ('CHEZ_COLLECTEUR', 'EN_TRANSIT') AND "collecteurId" IS NOT NULL;

UPDATE "contributions" c
SET "detenteurId" = t."receiverId"
FROM "funds_transfers" t
WHERE c."detenteurId" IS NULL AND c."statut" = 'CONFIRME'
  AND c."localisationFonds" IN ('CHEZ_RESPONSABLE', 'REMIS_TRESORIER')
  AND c."transferId" = t."id" AND t."status" = 'CONFIRMED';

-- 3. Position de départ du grand livre : une ligne par contribution confirmée,
--    datée de la mise en service (l'historique antérieur n'est pas reconstitué).
INSERT INTO "fund_movements" ("id", "contributionId", "montant", "fromLocation", "toLocation", "holderToId", "reason", "transferId", "bankDepositId", "at")
SELECT 'fm-reprise-' || c."id", c."id", c."montant", NULL, c."localisationFonds", c."detenteurId", 'REPRISE_INITIALE', c."transferId", c."bankDepositId", CURRENT_TIMESTAMP
FROM "contributions" c
WHERE c."statut" = 'CONFIRME'
  AND NOT EXISTS (SELECT 1 FROM "fund_movements" m WHERE m."contributionId" = c."id");
