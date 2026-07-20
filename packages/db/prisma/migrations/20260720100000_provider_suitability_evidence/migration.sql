-- Provider suitability evidence remains connection-scoped. Every new column is
-- nullable so existing installs upgrade as unknown/unreviewed; this migration
-- does not infer contract rights, entitlements, or evidence validity.
-- @migration-safety: data-safe: providerConnectionId is added nullable here, so every existing row is NULL before the foreign key is created.
ALTER TABLE "ComplianceEvidence"
  ADD COLUMN "providerConnectionId" TEXT,
  ADD COLUMN "claimKey" TEXT,
  ADD COLUMN "assertedValue" JSONB,
  ADD COLUMN "validFrom" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "RouteDecisionLog"
  ADD COLUMN "suitabilityReceipt" JSONB;

CREATE INDEX "ComplianceEvidence_providerConnectionId_claimKey_status_idx"
  ON "ComplianceEvidence"("providerConnectionId", "claimKey", "status");

CREATE INDEX "ComplianceEvidence_expiresAt_status_idx"
  ON "ComplianceEvidence"("expiresAt", "status");

ALTER TABLE "ComplianceEvidence"
  ADD CONSTRAINT "ComplianceEvidence_providerConnectionId_fkey"
  FOREIGN KEY ("providerConnectionId") REFERENCES "AiProviderConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
