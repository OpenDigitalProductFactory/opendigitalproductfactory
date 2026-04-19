-- Reverse the abandoned org-scoped portfolio drift.
-- Safe on fresh installs where Portfolio.organizationId was never added.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Portfolio'
      AND column_name = 'organizationId'
  ) AND EXISTS (
    SELECT slug
    FROM "Portfolio"
    GROUP BY slug
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot remove Portfolio.organizationId because duplicate portfolio slugs exist.';
  END IF;
END $$;

ALTER TABLE "Portfolio" DROP CONSTRAINT IF EXISTS "Portfolio_organizationId_fkey";

DROP INDEX IF EXISTS "Portfolio_organizationId_idx";
DROP INDEX IF EXISTS "Portfolio_organizationId_slug_key";

ALTER TABLE "Portfolio" DROP COLUMN IF EXISTS "organizationId";

CREATE UNIQUE INDEX IF NOT EXISTS "Portfolio_slug_key" ON "Portfolio"("slug");

DELETE FROM "Organization" o
WHERE o."orgId" = 'ORG-PLATFORM'
  AND NOT EXISTS (SELECT 1 FROM "BrandingConfig" b WHERE b."organizationId" = o.id)
  AND NOT EXISTS (SELECT 1 FROM "BusinessContext" bc WHERE bc."organizationId" = o.id)
  AND NOT EXISTS (SELECT 1 FROM "PlatformSetupProgress" sp WHERE sp."organizationId" = o.id)
  AND NOT EXISTS (SELECT 1 FROM "StorefrontConfig" sc WHERE sc."organizationId" = o.id);
