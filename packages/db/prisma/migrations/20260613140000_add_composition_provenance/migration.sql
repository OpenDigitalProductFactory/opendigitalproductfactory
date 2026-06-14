-- Phase 2 composition provenance (EP-ARCH-8D4F2A)
-- Adds sourceCompositionId to StorefrontItem and StorefrontSection so
-- removeStorefrontServiceLine can scope cleanup to a specific secondary's
-- seeded rows without relying on labels or category matching.
-- Adds removedAt to StorefrontArchetypeComposition for soft-delete lifecycle.

-- StorefrontArchetypeComposition: soft-delete field
ALTER TABLE "StorefrontArchetypeComposition" ADD COLUMN "removedAt" TIMESTAMP(3);
CREATE INDEX "StorefrontArchetypeComposition_removedAt_idx" ON "StorefrontArchetypeComposition"("removedAt");

-- StorefrontItem: provenance FK
ALTER TABLE "StorefrontItem" ADD COLUMN "sourceCompositionId" TEXT;
ALTER TABLE "StorefrontItem" ADD CONSTRAINT "StorefrontItem_sourceCompositionId_fkey"
  FOREIGN KEY ("sourceCompositionId")
  REFERENCES "StorefrontArchetypeComposition"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "StorefrontItem_sourceCompositionId_idx" ON "StorefrontItem"("sourceCompositionId");

-- StorefrontSection: provenance FK
ALTER TABLE "StorefrontSection" ADD COLUMN "sourceCompositionId" TEXT;
ALTER TABLE "StorefrontSection" ADD CONSTRAINT "StorefrontSection_sourceCompositionId_fkey"
  FOREIGN KEY ("sourceCompositionId")
  REFERENCES "StorefrontArchetypeComposition"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "StorefrontSection_sourceCompositionId_idx" ON "StorefrontSection"("sourceCompositionId");
