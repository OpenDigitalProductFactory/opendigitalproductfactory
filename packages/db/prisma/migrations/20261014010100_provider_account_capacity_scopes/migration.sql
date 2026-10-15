-- @migration-safety: data-safe: new nullable columns start NULL; backfilled scope
-- keys are unique because the existing legacy aliases are unique. Existing rows,
-- credentials, account capacity ownership and foreign keys are retained.
CREATE TYPE "CliPoolAdapterKind" AS ENUM ('claude_code', 'codex');
ALTER TABLE "ProviderCapacityStatus" ALTER COLUMN "providerId" DROP NOT NULL;
ALTER TABLE "ProviderCapacityStatus" ADD COLUMN "scopeKey" TEXT;
UPDATE "ProviderCapacityStatus" SET "scopeKey" = 'provider:' || "providerId" WHERE "providerId" IS NOT NULL;
CREATE UNIQUE INDEX "ProviderCapacityStatus_scopeKey_key" ON "ProviderCapacityStatus"("scopeKey");

ALTER TABLE "CliPoolStatus" ALTER COLUMN "adapterType" DROP NOT NULL;
ALTER TABLE "CliPoolStatus" ADD COLUMN "adapterKind" "CliPoolAdapterKind";
ALTER TABLE "CliPoolStatus" ADD COLUMN "scopeKey" TEXT;
UPDATE "CliPoolStatus" SET "scopeKey" = 'legacy-cli:' || "adapterType",
  "adapterKind" = CASE "adapterType" WHEN 'claude-cli' THEN 'claude_code'::"CliPoolAdapterKind" WHEN 'codex-cli' THEN 'codex'::"CliPoolAdapterKind" ELSE NULL END
  WHERE "adapterType" IS NOT NULL;
CREATE UNIQUE INDEX "CliPoolStatus_scopeKey_key" ON "CliPoolStatus"("scopeKey");

ALTER TABLE "AiProviderConnection" ADD COLUMN "quotaStatusId" TEXT;
CREATE INDEX "AiProviderConnection_quotaStatusId_idx" ON "AiProviderConnection"("quotaStatusId");
ALTER TABLE "AiProviderConnection" ADD CONSTRAINT "AiProviderConnection_quotaStatusId_fkey"
  FOREIGN KEY ("quotaStatusId") REFERENCES "ProviderCapacityStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Immutable telemetry dimensions follow existing providerId attribution: old
-- observations stay explicitly unattributed, and deletion never rewrites history.
ALTER TABLE "TokenUsage" ADD COLUMN "providerConnectionId" TEXT;
ALTER TABLE "TokenUsage" ADD COLUMN "quotaScopeKey" TEXT;
CREATE INDEX "TokenUsage_providerConnectionId_createdAt_idx" ON "TokenUsage"("providerConnectionId", "createdAt");
ALTER TABLE "RouteOutcome" ADD COLUMN "providerConnectionId" TEXT;
ALTER TABLE "RouteOutcome" ADD COLUMN "quotaScopeKey" TEXT;
CREATE INDEX "RouteOutcome_providerConnectionId_createdAt_idx" ON "RouteOutcome"("providerConnectionId", "createdAt");
