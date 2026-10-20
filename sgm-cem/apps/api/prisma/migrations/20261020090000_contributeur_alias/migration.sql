-- EF-M08-06 : le nom d'un contributeur externe connu n'est plus écrasé.
-- Le premier nom est conservé, les suivants deviennent des alias, et chaque
-- don garde le nom saisi ce jour-là (reçu, exports de la collecte).
ALTER TABLE "contributeurs_externes" ADD COLUMN IF NOT EXISTS "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "contributions" ADD COLUMN IF NOT EXISTS "nomDonateur" TEXT;

-- Dons existants : le nom connu à ce jour (les noms antérieurs ont été écrasés)
UPDATE "contributions" c
SET "nomDonateur" = ce."nom"
FROM "contributeurs_externes" ce
WHERE c."contributeurExterneId" = ce."id" AND c."nomDonateur" IS NULL AND ce."nom" <> 'Donateur anonymisé';
