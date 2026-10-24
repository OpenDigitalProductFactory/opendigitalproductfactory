-- BI-8CFA1CA8: agent-level data residency becomes a stated policy, not an
-- inference from a routing preference.
--
-- mcp-task-execution read `pinnedProviderId == 'local'` and set
-- residencyPolicy 'local_only' from it. That made one portal control carry two
-- unrelated decisions: an operator clearing a provider preference silently
-- relaxed a data-residency guarantee, and an operator choosing "local" from a
-- routing dropdown silently imposed one. Neither was visible as a policy.
--
-- The backfill preserves today's behaviour exactly: every config that is
-- currently local-pinned — and therefore currently routed local_only — gets
-- that policy written explicitly. Nothing else is touched, so a config that
-- never had a local pin keeps NULL, which routing reads as 'any_enabled'.
--
-- Forward-only and idempotent against any data state: IF NOT EXISTS on the
-- column, and the UPDATE is scoped to rows that still have no policy, so a
-- re-run cannot overwrite an operator's later choice.
--
-- Closed set: 'local_only' | 'approved_cloud' | 'any_enabled'. Stored as text
-- to match the existing TaskRequirement.residencyPolicy representation of the
-- same axis; typing the whole axis as a Prisma enum is a separate change so
-- that one axis does not end up with two representations mid-flight.
--
-- @migration-safety: data-safe: adds a nullable column and backfills only rows
-- whose current routed behaviour it restates; no rows are deleted or retyped.

ALTER TABLE "AgentModelConfig"
  ADD COLUMN IF NOT EXISTS "residencyPolicy" TEXT;

UPDATE "AgentModelConfig"
   SET "residencyPolicy" = 'local_only'
 WHERE "pinnedProviderId" = 'local'
   AND "residencyPolicy" IS NULL;
