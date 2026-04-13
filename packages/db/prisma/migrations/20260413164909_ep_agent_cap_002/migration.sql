-- AlterTable
ALTER TABLE "AgentModelConfig" ADD COLUMN     "minimumCapabilities" JSONB,
ADD COLUMN     "minimumContextTokens" INTEGER;

-- AlterTable
ALTER TABLE "DelegationChain" ALTER COLUMN "authorityScope" DROP DEFAULT,
ALTER COLUMN "originAuthority" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FeaturePack" ALTER COLUMN "applicableVerticals" DROP DEFAULT;

-- EP-AGENT-CAP-002: Backfill all existing coworker rows with the standard tool-use floor.
-- All currently seeded agents have tool_grants assigned; toolUse: true is correct for all.
-- Rows set to '{}' are explicit passive agents (rare, must be a deliberate admin choice).
UPDATE "AgentModelConfig"
SET "minimumCapabilities" = '{"toolUse": true}'::jsonb
WHERE "minimumCapabilities" IS NULL;
