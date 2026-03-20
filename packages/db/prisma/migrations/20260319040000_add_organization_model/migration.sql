-- CreateTable: Organization — canonical platform identity
CREATE TABLE "Organization" (
    "id"        TEXT NOT NULL,
    "orgId"     TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "legalName" TEXT,
    "slug"      TEXT NOT NULL,
    "industry"  TEXT,
    "website"   TEXT,
    "email"     TEXT,
    "phone"     TEXT,
    "address"   JSONB,
    "logoUrl"   TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_orgId_key" ON "Organization"("orgId");
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- AlterTable: Add organizationId FK to BrandingConfig
ALTER TABLE "BrandingConfig" ADD COLUMN "organizationId" TEXT;

-- CreateIndex: unique FK (one BrandingConfig per Organization)
CREATE UNIQUE INDEX "BrandingConfig_organizationId_key" ON "BrandingConfig"("organizationId");

-- AddForeignKey
ALTER TABLE "BrandingConfig" ADD CONSTRAINT "BrandingConfig_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: create one Organization row from existing BrandingConfig if present.
-- Safe no-op if BrandingConfig has no organization-scope row.
INSERT INTO "Organization" ("id", "orgId", "name", "slug", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  'ORG-000001',
  "companyName",
  lower(regexp_replace("companyName", '[^a-zA-Z0-9]+', '-', 'g')),
  now(),
  now()
FROM "BrandingConfig"
WHERE scope = 'organization'
LIMIT 1
ON CONFLICT DO NOTHING;

-- Link BrandingConfig to the Organization row if backfill ran.
UPDATE "BrandingConfig" bc
SET "organizationId" = o.id
FROM "Organization" o
WHERE bc.scope = 'organization'
  AND bc."organizationId" IS NULL;
