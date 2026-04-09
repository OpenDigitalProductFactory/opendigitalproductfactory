-- CreateTable
CREATE TABLE "BusinessContext" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "description" TEXT,
    "valueProposition" TEXT,
    "targetMarket" TEXT,
    "customerSegments" TEXT[],
    "revenueModel" TEXT,
    "companyStage" TEXT,
    "companySize" TEXT,
    "geographicScope" TEXT,
    "industry" TEXT,
    "ctaType" TEXT,
    "archetypeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessContext_organizationId_key" ON "BusinessContext"("organizationId");

-- AddForeignKey
ALTER TABLE "BusinessContext" ADD CONSTRAINT "BusinessContext_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: create BusinessContext for existing organizations that have a storefront
INSERT INTO "BusinessContext" ("id", "organizationId", "industry", "ctaType", "archetypeId", "updatedAt")
SELECT
    gen_random_uuid()::text,
    o."id",
    sa."category",
    sa."ctaType",
    sa."archetypeId",
    NOW()
FROM "Organization" o
JOIN "StorefrontConfig" sc ON sc."organizationId" = o."id"
JOIN "StorefrontArchetype" sa ON sa."id" = sc."archetypeId"
WHERE NOT EXISTS (
    SELECT 1 FROM "BusinessContext" bc WHERE bc."organizationId" = o."id"
);

-- Backfill: populate Organization.industry from archetype category where null
UPDATE "Organization" o
SET "industry" = sa."category"
FROM "StorefrontConfig" sc
JOIN "StorefrontArchetype" sa ON sa."id" = sc."archetypeId"
WHERE sc."organizationId" = o."id"
AND o."industry" IS NULL;
