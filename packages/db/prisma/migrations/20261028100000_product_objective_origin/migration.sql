-- BI-42399593 (WWMD DI-F3101AA957C7): where a ProductObjective came from, so
-- the platform can find the objective it derived for an epic, or the standing
-- platform-work objective, and create it at most once. Same origin convention
-- as Product.sourceKind/sourceRef. Nullable: objectives a person defines keep
-- no origin, and Postgres treats NULLs as distinct under the unique index.
ALTER TABLE "ProductObjective"
  ADD COLUMN "sourceKind" TEXT,
  ADD COLUMN "sourceRef" TEXT;

-- @migration-safety: data-safe: both columns are added by this migration, so every existing row holds NULL in them, and Postgres treats NULLs as distinct under a unique index; no existing row can violate it.
CREATE UNIQUE INDEX "ProductObjective_organizationId_sourceKind_sourceRef_key"
  ON "ProductObjective"("organizationId", "sourceKind", "sourceRef");

-- Closed set (BI-817ED2D4): the origins the platform writes, mirrored by
-- EPIC_OBJECTIVE_SOURCE_KIND and PLATFORM_WORK_OBJECTIVE_SOURCE_KIND in
-- apps/web/lib/product-management/delivered-work-outcomes.ts.
-- @migration-safety: data-safe: the column is added by this migration, so every existing row holds NULL, which the check allows.
ALTER TABLE "ProductObjective" ADD CONSTRAINT "ProductObjective_sourceKind_closed_set" CHECK (
  "sourceKind" IS NULL OR "sourceKind" IN ('epic', 'platform-work')
);
