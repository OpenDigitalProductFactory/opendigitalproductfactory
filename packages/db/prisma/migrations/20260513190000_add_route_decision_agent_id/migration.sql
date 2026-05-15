-- Persist direct AI coworker attribution on route decisions.
ALTER TABLE "RouteDecisionLog" ADD COLUMN "agentId" TEXT;

CREATE INDEX "RouteDecisionLog_agentId_createdAt_idx"
  ON "RouteDecisionLog"("agentId", "createdAt");
