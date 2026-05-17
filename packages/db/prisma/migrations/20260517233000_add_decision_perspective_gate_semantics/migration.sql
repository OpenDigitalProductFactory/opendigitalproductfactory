-- AddColumn
ALTER TABLE "PerspectiveMaterial" ADD COLUMN "domainClass" TEXT;
ALTER TABLE "PerspectiveMaterial" ADD COLUMN "direction" TEXT;

-- Backfill
UPDATE "PerspectiveMaterial"
SET "domainClass" = CASE
    WHEN "domains" @> ARRAY['build-studio-plan-advancement']::TEXT[] THEN 'plan-readiness'
    WHEN "domains" @> ARRAY['plan-readiness']::TEXT[] THEN 'plan-readiness'
    ELSE 'plan-readiness'
  END
WHERE "domainClass" IS NULL;

UPDATE "PerspectiveMaterial"
SET "direction" = COALESCE("sourceRef"->>'principleDirection', 'neutral')
WHERE "direction" IS NULL;

-- AlterColumn
ALTER TABLE "PerspectiveMaterial" ALTER COLUMN "domainClass" SET NOT NULL;
ALTER TABLE "PerspectiveMaterial" ALTER COLUMN "domainClass" SET DEFAULT 'plan-readiness';
ALTER TABLE "PerspectiveMaterial" ALTER COLUMN "direction" SET NOT NULL;
ALTER TABLE "PerspectiveMaterial" ALTER COLUMN "direction" SET DEFAULT 'neutral';

-- AddColumn
ALTER TABLE "DecisionInteraction" ADD COLUMN "triggeredByUserId" TEXT;
ALTER TABLE "DecisionInteraction" ADD COLUMN "domainClass" TEXT;
ALTER TABLE "DecisionInteraction" ADD COLUMN "principleConflict" BOOLEAN NOT NULL DEFAULT false;

-- Backfill
UPDATE "DecisionInteraction"
SET "domainClass" = COALESCE("outcomePayload"->>'domainClass', 'plan-readiness')
WHERE "domainClass" IS NULL;

UPDATE "DecisionInteraction"
SET "principleConflict" = COALESCE(("outcomePayload"->>'principleConflict')::BOOLEAN, false);

-- AlterColumn
ALTER TABLE "DecisionInteraction" ALTER COLUMN "domainClass" SET NOT NULL;
ALTER TABLE "DecisionInteraction" ALTER COLUMN "domainClass" SET DEFAULT 'plan-readiness';

-- CreateIndex
CREATE INDEX "PerspectiveMaterial_profileId_domainClass_idx" ON "PerspectiveMaterial"("profileId", "domainClass");

-- CreateIndex
CREATE INDEX "PerspectiveMaterial_domainClass_idx" ON "PerspectiveMaterial"("domainClass");

-- CreateIndex
CREATE INDEX "PerspectiveMaterial_direction_idx" ON "PerspectiveMaterial"("direction");

-- CreateIndex
CREATE INDEX "DecisionInteraction_triggeredByUserId_idx" ON "DecisionInteraction"("triggeredByUserId");

-- CreateIndex
CREATE INDEX "DecisionInteraction_domainClass_createdAt_idx" ON "DecisionInteraction"("domainClass", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionInteraction_principleConflict_createdAt_idx" ON "DecisionInteraction"("principleConflict", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionInteraction_open_build_phase_profile_key" ON "DecisionInteraction"("buildId", "phaseFrom", "phaseTo", "profileVersionId")
WHERE "buildId" IS NOT NULL AND "humanOutcome" IS NULL;

-- AddCheck
ALTER TABLE "PerspectiveMaterial" ADD CONSTRAINT "PerspectiveMaterial_domainClass_check" CHECK ("domainClass" IN ('plan-readiness', 'architecture-tradeoff', 'risk-assessment'));

-- AddCheck
ALTER TABLE "PerspectiveMaterial" ADD CONSTRAINT "PerspectiveMaterial_direction_check" CHECK ("direction" IN ('support', 'oppose', 'neutral'));

-- AddCheck
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_domainClass_check" CHECK ("domainClass" IN ('plan-readiness', 'architecture-tradeoff', 'risk-assessment'));

-- AddForeignKey
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
