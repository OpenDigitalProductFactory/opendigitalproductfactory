-- Portfolio becomes org-scoped: every portfolio belongs to exactly one Organization.
-- The 4 IT4IT-canonical portfolios (foundational, manufacturing_and_delivery,
-- for_employees, products_and_services_sold) are created per-org at org creation
-- time rather than globally at seed time.

-- 1. Add column nullable so the backfill can populate it
ALTER TABLE "Portfolio" ADD COLUMN "organizationId" TEXT;

-- 2. Backfill: assign existing portfolios to the single existing org, if exactly one exists.
--    On fresh installs (no orgs yet) this is a no-op.
UPDATE "Portfolio"
SET "organizationId" = (SELECT id FROM "Organization" LIMIT 1)
WHERE "organizationId" IS NULL
  AND (SELECT COUNT(*) FROM "Organization") = 1;

-- 3. Drop any orphan portfolios that could not be assigned to an org.
--    Expected: zero rows on single-org install (backfill covered them),
--    zero rows on fresh install (no portfolios exist yet).
DELETE FROM "Portfolio" WHERE "organizationId" IS NULL;

-- 4. Tighten to NOT NULL
ALTER TABLE "Portfolio" ALTER COLUMN "organizationId" SET NOT NULL;

-- 5. Add FK with cascade delete (an org's portfolios go with the org)
ALTER TABLE "Portfolio"
ADD CONSTRAINT "Portfolio_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Replace global slug uniqueness with per-org uniqueness.
DROP INDEX "Portfolio_slug_key";
CREATE UNIQUE INDEX "Portfolio_organizationId_slug_key" ON "Portfolio"("organizationId", "slug");

-- 7. Add FK lookup index
CREATE INDEX "Portfolio_organizationId_idx" ON "Portfolio"("organizationId");
