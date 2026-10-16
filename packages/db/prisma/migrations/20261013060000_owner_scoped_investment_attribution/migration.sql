-- Additive only. Legacy attempts remain unassigned; no ownership backfill.
-- @migration-safety: data-safe: all three foreign-key columns are newly added nullable columns in this migration; existing rows are NULL and no attribution backfill runs before constraint creation.
CREATE TYPE "InvestmentWorkPurpose" AS ENUM ('sharedPlatform', 'archetype');
CREATE TYPE "InvestmentWorkClass" AS ENUM ('refactor', 'new');
ALTER TABLE "AdapterRunTelemetry"
  ADD COLUMN "investmentPrincipalId" TEXT,
  ADD COLUMN "investmentOrganizationId" TEXT,
  ADD COLUMN "investmentItemId" TEXT,
  ADD COLUMN "investmentPurpose" "InvestmentWorkPurpose",
  ADD COLUMN "investmentClass" "InvestmentWorkClass",
  ADD COLUMN "investmentPolicyRef" TEXT,
  ADD COLUMN "investmentInstallationRef" TEXT,
  ADD COLUMN "investmentCapturedAt" TIMESTAMP(3);
CREATE INDEX "AdapterRunTelemetry_investment_scope_startedAt_idx" ON "AdapterRunTelemetry" ("investmentPrincipalId", "investmentOrganizationId", "investmentPurpose", "startedAt");
CREATE INDEX "AdapterRunTelemetry_investmentOrganizationId_idx" ON "AdapterRunTelemetry" ("investmentOrganizationId");
CREATE INDEX "AdapterRunTelemetry_investmentItemId_idx" ON "AdapterRunTelemetry" ("investmentItemId");
-- Restrict deletion during the existing retention window: history cannot silently change owners.
ALTER TABLE "AdapterRunTelemetry" ADD CONSTRAINT "AdapterRunTelemetry_investmentPrincipalId_fkey" FOREIGN KEY ("investmentPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdapterRunTelemetry" ADD CONSTRAINT "AdapterRunTelemetry_investmentOrganizationId_fkey" FOREIGN KEY ("investmentOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdapterRunTelemetry" ADD CONSTRAINT "AdapterRunTelemetry_investmentItemId_fkey" FOREIGN KEY ("investmentItemId") REFERENCES "BacklogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
