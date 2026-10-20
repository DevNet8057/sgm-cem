-- Point 17 : suivi d'erreurs des tâches planifiées, webhooks et envois
DO $$ BEGIN
  CREATE TYPE "IncidentSource" AS ENUM ('TACHE', 'WEBHOOK', 'ENVOI');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "incidents" (
  "id" TEXT NOT NULL,
  "source" "IncidentSource" NOT NULL,
  "code" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "premiereFois" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "derniereFois" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resoluLe" TIMESTAMP(3),
  "resoluPar" TEXT,
  CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "incidents_resoluLe_derniereFois_idx" ON "incidents"("resoluLe", "derniereFois");
CREATE INDEX IF NOT EXISTS "incidents_source_code_idx" ON "incidents"("source", "code");

CREATE TABLE IF NOT EXISTS "taches_etat" (
  "nom" TEXT NOT NULL,
  "dernierDebut" TIMESTAMP(3),
  "dernierSucces" TIMESTAMP(3),
  "derniereErreur" TIMESTAMP(3),
  "erreur" TEXT,
  "resultat" TEXT,
  "dureeMs" INTEGER,
  CONSTRAINT "taches_etat_pkey" PRIMARY KEY ("nom")
);
