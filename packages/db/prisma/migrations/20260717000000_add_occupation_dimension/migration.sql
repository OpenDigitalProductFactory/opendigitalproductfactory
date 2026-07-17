-- EP-EMPLOYEE-OCCUPATION Phase 1 (BI-442E2B42): the occupation dimension.
-- Adds the OccupationProfile registry table + a nullable Position.occupationKey
-- slug reference. Occupation is config/template (not an identity Principal) that
-- FOCUSES the workspace surface and ADDS a governed coworker roster; it never
-- widens the platform-management RBAC floor. Spec §5.1/§5.2.
--
-- @migration-safety: data-safe. Position.occupationKey is added nullable with no
-- default (metadata-only change, no table rewrite, no existing row can violate
-- it); an unmapped position resolves to the archetype/platform fallback. The new
-- OccupationProfile table is created empty and populated by the seed
-- (packages/db/src/seed-occupations.ts from packages/db/data/occupation_registry.json).
-- No constraints are tightened over existing data; occupationKey is a slug
-- reference validated in app code, deliberately NOT a foreign key (mirrors the
-- StorefrontConfig.archetypeId semantic-slug pattern).

-- CreateTable
CREATE TABLE "OccupationProfile" (
    "id" TEXT NOT NULL,
    "occupationKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "archetypeCategories" TEXT[],
    "archetypeIds" TEXT[],
    "baseAccessProfile" TEXT NOT NULL,
    "wsidProfessionFamily" TEXT,
    "featureSurface" JSONB NOT NULL,
    "coworkerRoster" JSONB NOT NULL,
    "onboardingCurriculumId" TEXT NOT NULL,
    "moverCurriculumId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OccupationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OccupationProfile_occupationKey_key" ON "OccupationProfile"("occupationKey");

-- CreateIndex
CREATE INDEX "OccupationProfile_isActive_idx" ON "OccupationProfile"("isActive");

-- AlterTable
ALTER TABLE "Position" ADD COLUMN "occupationKey" TEXT;

-- CreateIndex
CREATE INDEX "Position_occupationKey_idx" ON "Position"("occupationKey");
