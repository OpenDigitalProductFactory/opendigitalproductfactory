-- Add identity-bound SAS commit/reveal state to the existing pairing session.
-- Existing rows remain valid and continue through their original lifecycle.
ALTER TABLE "FederationPairingSession"
ADD COLUMN "sasState" JSONB,
ADD COLUMN "sasConfirmedAtLocal" TIMESTAMP(3),
ADD COLUMN "sasConfirmedAtPeer" TIMESTAMP(3);
