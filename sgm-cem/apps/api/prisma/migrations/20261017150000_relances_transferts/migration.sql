-- Lot 4.3 : alerte trésorerie unique pour un transfert non traité (EF-M07-08)
ALTER TABLE "funds_transfers" ADD COLUMN IF NOT EXISTS "tresorierAlertedAt" TIMESTAMP(3);
