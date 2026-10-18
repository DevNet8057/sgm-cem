-- Reprise : les contributions déjà annulées après litige restaient comptées à leur
-- dernier emplacement du grand livre. Une sortie est inscrite (idempotent).
INSERT INTO "fund_movements" ("id", "contributionId", "montant", "fromLocation", "toLocation", "holderFromId", "holderToId", "reason", "at")
SELECT 'fm-annul-' || c."id", c."id", last."montant", last."toLocation", 'HORS_CIRCUIT', last."holderToId", NULL, 'ANNULATION_LITIGE', CURRENT_TIMESTAMP
FROM "contributions" c
JOIN LATERAL (
  SELECT m."toLocation", m."holderToId", m."montant" FROM "fund_movements" m
  WHERE m."contributionId" = c."id" ORDER BY m."at" DESC, m."id" DESC LIMIT 1
) last ON TRUE
WHERE c."statut" = 'ANNULE' AND last."toLocation" <> 'HORS_CIRCUIT'
ON CONFLICT ("id") DO NOTHING;

UPDATE "contributions" c
SET "localisationFonds" = 'HORS_CIRCUIT', "detenteurId" = NULL
WHERE c."statut" = 'ANNULE'
  AND EXISTS (SELECT 1 FROM "fund_movements" m WHERE m."contributionId" = c."id");
