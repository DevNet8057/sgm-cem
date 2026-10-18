-- Sortie du circuit d'une contribution confirmée puis annulée après litige.
-- Valeurs ajoutées seules : PostgreSQL interdit de les utiliser dans la même transaction.
ALTER TYPE "LocalisationFonds" ADD VALUE IF NOT EXISTS 'HORS_CIRCUIT';
ALTER TYPE "FundMovementReason" ADD VALUE IF NOT EXISTS 'ANNULATION_LITIGE';
