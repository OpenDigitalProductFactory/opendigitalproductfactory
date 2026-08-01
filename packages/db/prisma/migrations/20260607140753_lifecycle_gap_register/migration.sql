-- Unified Lifecycle Backbone (EP-LIFECYCLE / slice 4) — LifecycleGap register + EOL signal
-- Spec: docs/superpowers/specs/2026-06-07-unified-lifecycle-backbone-design.md §6-7, §8.6-8.7

-- AlterTable
ALTER TABLE "InventoryEntity" ADD COLUMN     "supportEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LifecycleGap" (
    "id" TEXT NOT NULL,
    "gapKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "scopeLevel" TEXT NOT NULL DEFAULT 'portfolio',
    "governedThingKind" TEXT NOT NULL,
    "governedThingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "baselinePlateauId" TEXT,
    "targetPlateauId" TEXT,
    "workPackageElementId" TEXT,
    "eaGapElementId" TEXT,
    "backlogItemId" TEXT,
    "digitalProductId" TEXT,
    "evidenceRef" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LifecycleGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleGap_gapKey_key" ON "LifecycleGap"("gapKey");

-- CreateIndex
CREATE INDEX "LifecycleGap_status_idx" ON "LifecycleGap"("status");

-- CreateIndex
CREATE INDEX "LifecycleGap_dimension_idx" ON "LifecycleGap"("dimension");

-- CreateIndex
CREATE INDEX "LifecycleGap_scopeLevel_idx" ON "LifecycleGap"("scopeLevel");

-- CreateIndex
CREATE INDEX "LifecycleGap_governedThingKind_governedThingId_idx" ON "LifecycleGap"("governedThingKind", "governedThingId");

-- CreateIndex
CREATE INDEX "LifecycleGap_backlogItemId_idx" ON "LifecycleGap"("backlogItemId");

-- CreateIndex
CREATE INDEX "LifecycleGap_digitalProductId_idx" ON "LifecycleGap"("digitalProductId");

