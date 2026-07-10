-- EP-DEMAND-MGMT Phase 1: demand-management scoring inputs + funnel facet on
-- BacklogItem. Store the scoring INPUTS as first-class nullable columns; the
-- score is computed by a pluggable framework (apps/web/lib/demand/scoring.ts).
-- @migration-safety: data-safe: all columns are nullable additions and the new
-- indexes are non-unique; no existing row can violate any constraint.
ALTER TABLE "BacklogItem"
    ADD COLUMN "demandStage" TEXT,
    ADD COLUMN "reach" INTEGER,
    ADD COLUMN "impact" DOUBLE PRECISION,
    ADD COLUMN "confidence" DOUBLE PRECISION,
    ADD COLUMN "businessValue" INTEGER,
    ADD COLUMN "timeCriticality" INTEGER,
    ADD COLUMN "riskOpportunity" INTEGER,
    ADD COLUMN "jobSize" DOUBLE PRECISION,
    ADD COLUMN "demandScore" DOUBLE PRECISION,
    ADD COLUMN "demandScoreFramework" TEXT,
    ADD COLUMN "demandScoreComputedAt" TIMESTAMP(3);

CREATE INDEX "BacklogItem_portfolioId_demandScore_idx" ON "BacklogItem"("portfolioId", "demandScore");
CREATE INDEX "BacklogItem_demandStage_idx" ON "BacklogItem"("demandStage");
