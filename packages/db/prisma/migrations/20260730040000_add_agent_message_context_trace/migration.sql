-- BI-3E218D80: persist the context arbitration trace per coworker turn.
--
-- Extends EP-CTX-001 §9 (Observability). That section specified aggregate Prometheus
-- counters (never built) plus a dev-mode debug log; neither can answer "why didn't THIS
-- coworker know X on THIS turn", which is the question a single incident actually poses.
-- Until now `ArbitrationResult.dropped` was consumed only by a console formatter, so
-- "never retrieved" / "dropped for budget" / "present but ignored" were indistinguishable.
--
-- Shape is `ArbitrationTrace` from apps/web/lib/tak/arbitration-trace.ts (versioned).
-- It holds SOURCE LABELS AND TOKEN COUNTS ONLY, never source content — that content is
-- recalled user facts and page data already persisted in their own tables, and copying it
-- here would create a second ungoverned retention surface for the same sensitive text.
--
-- @migration-safety: additive-nullable. One nullable JSONB column on an existing table.
-- No default, so PostgreSQL does not rewrite existing rows; no constraint, index, backfill,
-- or lock beyond the brief ACCESS EXCLUSIVE that ADD COLUMN takes to update the catalog.
-- Every pre-existing AgentMessage row remains valid with NULL, and a turn that performs no
-- arbitration (system messages) legitimately stores nothing.

ALTER TABLE "AgentMessage" ADD COLUMN "contextTrace" JSONB;
