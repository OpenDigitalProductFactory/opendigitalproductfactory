-- Preserve coworker attribution for route outcomes so fallback/error map events
-- can be tied back to the AI coworker that invoked the provider path.
ALTER TABLE "RouteOutcome" ADD COLUMN "agentId" TEXT;

CREATE INDEX "RouteOutcome_agentId_createdAt_idx" ON "RouteOutcome"("agentId", "createdAt");
