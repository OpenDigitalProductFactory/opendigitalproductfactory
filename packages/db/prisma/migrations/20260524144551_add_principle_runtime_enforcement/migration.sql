-- Runtime enforcement payload for tier-1 kernel commandments (spec 2026-05-24).
-- Shape: {interactiveMode, autonomousMode, patterns: [{kind, regex|toolName, rationale}]}
-- Read by apps/web/lib/kernel/runtime-gate.ts at execution time; orthogonal to
-- the decision-time substrate (apps/web/lib/wiki/principle-decide.ts).
--
-- BI-43F95F77 / EP-DR-HARDENING-2026-05-23.
ALTER TABLE "WikiPage" ADD COLUMN "principleRuntimeEnforcement" JSONB;
