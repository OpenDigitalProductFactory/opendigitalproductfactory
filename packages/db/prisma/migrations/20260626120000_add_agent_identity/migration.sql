-- EP-COWORKER-RT Phase 1: canonical coworker identity.
-- Adds Agent.displayName (the one human-facing label) and Agent.kind (role-type facet).
-- Backfill is best-effort here; the seed (resolveAgentIdentity in agent-identity.ts) writes
-- the canonical values on the next seed run. Columns end NOT NULL with no default to match
-- the Prisma schema (displayName String / kind String).

ALTER TABLE "Agent" ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Agent" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'specialist';

-- displayName: strip a trailing "-agent" / "-specialist" noise suffix, de-hyphenate, Title Case.
UPDATE "Agent"
SET "displayName" = initcap(replace(regexp_replace("name", '[-_](agent|specialist)$', ''), '-', ' '))
WHERE "displayName" = '';
-- Guarantee non-empty for any row the regexp left blank.
UPDATE "Agent" SET "displayName" = "name" WHERE "displayName" IS NULL OR btrim("displayName") = '';

-- kind: derive from id / name (seed refines per-agent afterwards).
UPDATE "Agent" SET "kind" = 'orchestrator' WHERE "agentId" LIKE 'AGT-ORCH-%' OR "name" LIKE '%orchestrator';
UPDATE "Agent" SET "kind" = 'engineer'     WHERE "name" LIKE '%engineer';
UPDATE "Agent" SET "kind" = 'advisor'      WHERE "name" LIKE '%advisor';
UPDATE "Agent" SET "kind" = 'analyst'      WHERE "name" LIKE '%analyst';
UPDATE "Agent" SET "kind" = 'coordinator'  WHERE "name" LIKE '%coordinator';

-- Drop the bootstrap defaults; seed + app writes now supply explicit values.
ALTER TABLE "Agent" ALTER COLUMN "displayName" DROP DEFAULT;
ALTER TABLE "Agent" ALTER COLUMN "kind" DROP DEFAULT;
