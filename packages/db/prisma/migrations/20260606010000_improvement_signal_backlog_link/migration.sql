-- EP-INTAKE-UNIFY / BI-B716B387: back-link an ImprovementSignal to the
-- BacklogItem it was projected into once it becomes persistent. Additive,
-- nullable column — no backfill needed (existing signals stay unlinked until
-- they next cross the recurrence threshold).
ALTER TABLE "ImprovementSignal" ADD COLUMN "backlogItemId" TEXT;

CREATE INDEX "ImprovementSignal_backlogItemId_idx" ON "ImprovementSignal"("backlogItemId");
