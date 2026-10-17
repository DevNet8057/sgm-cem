-- Lot 4.2 : clôture mensuelle (EF-M07-09), montants figés des mois visés
-- CreateEnum
DO $$ BEGIN CREATE TYPE "ClotureStatut" AS ENUM ('PRESENTEE', 'VALIDEE', 'REJETEE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "clotures_mensuelles" (
    "id" TEXT NOT NULL,
    "annee" INTEGER NOT NULL,
    "mois" INTEGER NOT NULL,
    "statut" "ClotureStatut" NOT NULL DEFAULT 'PRESENTEE',
    "positionFin" JSONB NOT NULL,
    "totalEncaisse" INTEGER NOT NULL,
    "totalRembourse" INTEGER NOT NULL,
    "nbContributions" INTEGER NOT NULL,
    "attenduCaisse" INTEGER NOT NULL,
    "attenduBanque" INTEGER NOT NULL,
    "attenduPortefeuille" INTEGER NOT NULL,
    "caisseComptee" INTEGER NOT NULL,
    "soldeBancaire" INTEGER NOT NULL,
    "soldePortefeuille" INTEGER NOT NULL,
    "justification" TEXT,
    "presentedById" TEXT NOT NULL,
    "presentedByName" TEXT NOT NULL,
    "presentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedById" TEXT,
    "validatedByName" TEXT,
    "validatedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "clotures_mensuelles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "clotures_mensuelles_annee_mois_key" ON "clotures_mensuelles"("annee", "mois");


-- Montants figés : dans un mois clôturé et visé (heure de Yaoundé), le montant
-- d'une contribution ne change plus et elle ne peut pas être supprimée.
-- Les statuts restent modifiables (décision du Bureau du 17/10/2026) ;
-- une correction passe par une écriture du mois en cours (remboursement…).
CREATE OR REPLACE FUNCTION sgm_contribution_mois_clos() RETURNS trigger AS $$
DECLARE
  local_ts timestamp := (OLD."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Douala';
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."montant" IS NOT DISTINCT FROM OLD."montant" AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "clotures_mensuelles"
    WHERE "statut" = 'VALIDEE' AND "annee" = EXTRACT(YEAR FROM local_ts) AND "mois" = EXTRACT(MONTH FROM local_ts)
  ) THEN
    RAISE EXCEPTION 'MOIS_CLOS: montant d''une contribution d''un mois clôturé (%/%) non modifiable', EXTRACT(MONTH FROM local_ts), EXTRACT(YEAR FROM local_ts)
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contributions_mois_clos ON "contributions";
CREATE TRIGGER contributions_mois_clos
  BEFORE UPDATE OF "montant", "createdAt" OR DELETE ON "contributions"
  FOR EACH ROW EXECUTE FUNCTION sgm_contribution_mois_clos();
