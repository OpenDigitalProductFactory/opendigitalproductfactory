-- Architecture-convergence cleanup (2026-06-19). Drop vestigial / deprecated
-- columns proven dead by a compiler-oracle audit (schema removed, client
-- regenerated, `tsc` reported zero references):
--   * ModelProvider's per-model scoring is owned by ModelProfile. These six
--     columns have ZERO remaining references. The ModelProvider score columns
--     that the provider UI still reads (codegen, toolFidelity, reasoning, etc.)
--     are intentionally KEPT until that data layer is migrated to ModelProfile.
--   * BusinessContext.archetypeId was @deprecated in favour of the canonical
--     StorefrontConfig.archetypeId.
-- Sanctioned per AGENTS.md Section 11; allowlisted in
-- packages/db/scripts/schema-regression-guard.mjs (INTENTIONAL_FIELD_REMOVALS).

-- AlterTable
ALTER TABLE "ModelProvider" DROP COLUMN "customScores",
DROP COLUMN "evalCount",
DROP COLUMN "lastCallAt",
DROP COLUMN "lastEvalAt",
DROP COLUMN "profileConfidence",
DROP COLUMN "supportedModalities";

-- AlterTable
ALTER TABLE "BusinessContext" DROP COLUMN "archetypeId";
