-- Denormalized portfolio attribution on BacklogItem (BI-PORTPRIO-1) — a cache of
-- resolveBacklogPortfolio (digitalProduct -> taxonomyNode -> epic precedence) so
-- the backlog can be grouped, budgeted, and ranked per portfolio. Additive +
-- nullable; populated by the resolver on create + a backfill.
ALTER TABLE "BacklogItem" ADD COLUMN "portfolioId" TEXT;

-- CreateIndex
CREATE INDEX "BacklogItem_portfolioId_idx" ON "BacklogItem"("portfolioId");
