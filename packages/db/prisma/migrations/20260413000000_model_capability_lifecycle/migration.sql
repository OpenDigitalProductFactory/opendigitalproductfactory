-- Add new columns to ModelProfile
ALTER TABLE "ModelProfile" ADD COLUMN "catalogHash"         TEXT;
ALTER TABLE "ModelProfile" ADD COLUMN "discoveryHash"       TEXT;
ALTER TABLE "ModelProfile" ADD COLUMN "capabilityOverrides" JSONB;

-- Make supportsToolUse nullable (drop NOT NULL and default)
ALTER TABLE "ModelProfile" ALTER COLUMN "supportsToolUse" DROP DEFAULT;
ALTER TABLE "ModelProfile" ALTER COLUMN "supportsToolUse" DROP NOT NULL;

-- Migrate existing rawMetadataHash into discoveryHash (discovery-owned profiles only)
UPDATE "ModelProfile"
SET "discoveryHash" = "rawMetadataHash"
WHERE "rawMetadataHash" IS NOT NULL
  AND "profileSource" IN ('auto-discover', 'evaluated');

-- Normalize: convert ambiguous default-false supportsToolUse to NULL
-- for catalog/seed rows where no explicit adapter value was stored in capabilities.
-- (false was the Prisma default, not an explicit "this model cannot use tools" decision)
UPDATE "ModelProfile"
SET "supportsToolUse" = NULL
WHERE "supportsToolUse" = false
  AND COALESCE(("capabilities"->>'toolUse')::boolean, NULL) IS NULL
  AND "profileSource" IN ('seed', 'catalog');

-- Create ModelCapabilityChangeLog
CREATE TABLE "ModelCapabilityChangeLog" (
  "id"         TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "modelId"    TEXT NOT NULL,
  "field"      TEXT NOT NULL,
  "oldValue"   JSONB,
  "newValue"   JSONB,
  "source"     TEXT NOT NULL,
  "changedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedBy"  TEXT,
  CONSTRAINT "ModelCapabilityChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModelCapabilityChangeLog_providerId_changedAt_idx"
  ON "ModelCapabilityChangeLog"("providerId", "changedAt");

CREATE INDEX "ModelCapabilityChangeLog_modelId_changedAt_idx"
  ON "ModelCapabilityChangeLog"("modelId", "changedAt");
