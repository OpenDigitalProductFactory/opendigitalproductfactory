-- @migration-safety: data-safe: nullable ownership/revision columns preserve
-- all existing observations; no existing row receives an inferred owner.
-- New health is bounded to one row per immutable account. Account removal clears
-- only this mutable projection; immutable metering and route history are retained.
ALTER TABLE "ProviderCapacityStatus" ADD COLUMN "ownedAccountId" TEXT;
ALTER TABLE "ProviderCapacityStatus" ADD COLUMN "observedCredentialRevision" TEXT;
CREATE UNIQUE INDEX "ProviderCapacityStatus_ownedAccountId_key" ON "ProviderCapacityStatus"("ownedAccountId");
ALTER TABLE "ProviderCapacityStatus" ADD CONSTRAINT "ProviderCapacityStatus_ownedAccountId_fkey"
  FOREIGN KEY ("ownedAccountId") REFERENCES "AiProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
