-- Décision du Bureau (17/10/2026) : tous les paiements électroniques confirmés
-- et non versés en banque sont sur le portefeuille électronique (compte
-- marchand) — y compris ceux déplacés « en caisse » par l'ancien raccourci.
-- La sauvegarde automatique prise au démarrage garde l'état précédent.
-- Idempotent : sans effet sur une base neuve ou déjà reclassée.
UPDATE "contributions"
SET "localisationFonds" = 'PORTEFEUILLE_ELECTRONIQUE'
WHERE "statut" = 'CONFIRME'
  AND "modePaiement" IN ('MTN_MOMO', 'ORANGE_MONEY', 'YELII', 'CARTE_VISA')
  AND "localisationFonds" NOT IN ('EN_BANQUE', 'PORTEFEUILLE_ELECTRONIQUE')
  AND "bankDepositId" IS NULL
  -- jamais une contribution engagée dans un transfert en attente
  AND NOT ("localisationFonds" = 'EN_TRANSIT' AND "transferId" IS NOT NULL);

-- Ancienne saisie rapide Yelii : l'identifiant de transaction n'était rangé que
-- dans momoTransactionId, invisible du webhook et de la réconciliation.
UPDATE "contributions"
SET "externalTransactionId" = "momoTransactionId"
WHERE "modePaiement" = 'YELII'
  AND "externalTransactionId" IS NULL
  AND "momoTransactionId" IS NOT NULL
  AND "statut" = 'EN_ATTENTE_CONFIRMATION';
