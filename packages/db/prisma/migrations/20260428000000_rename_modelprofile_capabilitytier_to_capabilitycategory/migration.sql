-- Rename ModelProfile.capabilityTier to capabilityCategory.
--
-- Per the routing architectural spec (2026-04-27-routing-control-data-plane-design.md
-- §7.2 Phase B and §8.1), this column is the legacy LLM-grading vocabulary
-- ('deep-thinker' / 'fast-worker' / 'specialist' / 'budget' / 'embedding').
-- Routing must read only `qualityTier`. The column survives, renamed to
-- reflect its actual purpose: friendly admin-UI categorization, not a
-- routing tier. INV-6 in the boot-invariant audit names this directly.
--
-- This is a pure rename; values are preserved. Reversible via the inverse
-- ALTER TABLE statement.
--
-- The sister column ModelProvider.capabilityTier (MCP service capability,
-- default 'basic', paired with costBand/taskTags/sensitivityClearance) is
-- a different concept and is NOT renamed by this migration.

ALTER TABLE "ModelProfile" RENAME COLUMN "capabilityTier" TO "capabilityCategory";
