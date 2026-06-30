-- Add layer/portfolio/outcome scope metadata to Work Capsules.
-- Existing capsules remain valid and unscoped.
ALTER TABLE "WorkCapsule"
  ADD COLUMN "decisionScope" TEXT,
  ADD COLUMN "portfolioRole" TEXT,
  ADD COLUMN "servedPersona" TEXT,
  ADD COLUMN "activityKind" TEXT,
  ADD COLUMN "outcomeAnchor" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "servesPortfolioRoles" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "dependsOnPortfolioRoles" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "WorkCapsule_decisionScope_idx" ON "WorkCapsule"("decisionScope");
CREATE INDEX "WorkCapsule_portfolioRole_idx" ON "WorkCapsule"("portfolioRole");
CREATE INDEX "WorkCapsule_activityKind_idx" ON "WorkCapsule"("activityKind");
