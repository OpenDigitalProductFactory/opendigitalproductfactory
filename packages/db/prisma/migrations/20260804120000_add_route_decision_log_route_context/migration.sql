-- BI-CF3049E7: record WHICH route declared the sensitivity a decision routed at.
--
-- Nullable by design: non-route callers (scheduled jobs, system tasks) genuinely
-- have no route, and every existing row predates the column. Backfilling is not
-- possible — the route was never captured — so old rows stay NULL and the drift
-- rollup reports them as unattributed rather than guessing.
ALTER TABLE "RouteDecisionLog" ADD COLUMN "routeContext" TEXT;

-- Supports the drift rollup's "recent decisions grouped by route" read.
CREATE INDEX "RouteDecisionLog_routeContext_createdAt_idx"
  ON "RouteDecisionLog"("routeContext", "createdAt");
