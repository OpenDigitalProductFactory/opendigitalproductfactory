-- Unified Lifecycle Backbone (EP-LIFECYCLE / slice 2)
-- Spec: docs/superpowers/specs/2026-06-07-unified-lifecycle-backbone-design.md §8.3-8.5

-- CreateTable
CREATE TABLE "LifecycleEvent" (
    "id" TEXT NOT NULL,
    "governedThingKind" TEXT NOT NULL,
    "governedThingId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "reason" TEXT,
    "evidenceRef" TEXT,
    "actorPrincipalId" TEXT,
    "toolExecutionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlateauMembership" (
    "id" TEXT NOT NULL,
    "plateauElementId" TEXT NOT NULL,
    "governedThingKind" TEXT NOT NULL,
    "governedThingId" TEXT NOT NULL,
    "membershipSource" TEXT NOT NULL DEFAULT 'projected',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "stateSnapshot" JSONB NOT NULL DEFAULT '{}',
    "evidenceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlateauMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LifecycleEvent_governedThingKind_governedThingId_createdAt_idx" ON "LifecycleEvent"("governedThingKind", "governedThingId", "createdAt");

-- CreateIndex
CREATE INDEX "LifecycleEvent_actorPrincipalId_idx" ON "LifecycleEvent"("actorPrincipalId");

-- CreateIndex
CREATE INDEX "LifecycleEvent_toolExecutionId_idx" ON "LifecycleEvent"("toolExecutionId");

-- CreateIndex
CREATE INDEX "PlateauMembership_governedThingKind_governedThingId_idx" ON "PlateauMembership"("governedThingKind", "governedThingId");

-- CreateIndex
CREATE INDEX "PlateauMembership_membershipSource_idx" ON "PlateauMembership"("membershipSource");

-- CreateIndex
CREATE INDEX "PlateauMembership_plateauElementId_idx" ON "PlateauMembership"("plateauElementId");

-- CreateIndex
CREATE UNIQUE INDEX "PlateauMembership_plateauElementId_governedThingKind_govern_key" ON "PlateauMembership"("plateauElementId", "governedThingKind", "governedThingId");

-- CreateIndex
CREATE INDEX "EaElement_refinementLevel_idx" ON "EaElement"("refinementLevel");

-- AddForeignKey
ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_actorPrincipalId_fkey" FOREIGN KEY ("actorPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_toolExecutionId_fkey" FOREIGN KEY ("toolExecutionId") REFERENCES "ToolExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateauMembership" ADD CONSTRAINT "PlateauMembership_plateauElementId_fkey" FOREIGN KEY ("plateauElementId") REFERENCES "EaElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill: classify existing EaElements onto the realization-stage axis ──────────
-- Conservative, evidence-based: elements wrapping a real CI (infraCiKey) are manifested
-- (actual); all other unclassified EA constructs default to the logical middle. Architects
-- refine conceptual/actual later. Spec §8.3 (slice 1 backfill, applied with the index).
UPDATE "EaElement" SET "refinementLevel" = 'actual'
  WHERE "refinementLevel" IS NULL AND "infraCiKey" IS NOT NULL;

UPDATE "EaElement" SET "refinementLevel" = 'logical'
  WHERE "refinementLevel" IS NULL;
