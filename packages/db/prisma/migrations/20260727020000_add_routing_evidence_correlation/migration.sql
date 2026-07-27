-- Add nullable, request-scoped routing correlation and design provenance.
-- Historic rows intentionally remain NULL: there is no trustworthy heuristic
-- backfill across the existing independently-keyed ledgers.
-- @migration-safety: data-safe: nullable columns and non-unique indexes cannot invalidate existing rows
ALTER TABLE "TokenUsage" ADD COLUMN "traceId" TEXT;
ALTER TABLE "RouteOutcome" ADD COLUMN "traceId" TEXT;
ALTER TABLE "AdapterRunTelemetry" ADD COLUMN "traceId" TEXT;
ALTER TABLE "RouteDecisionLog"
  ADD COLUMN "traceId" TEXT,
  ADD COLUMN "designRevision" TEXT;

CREATE INDEX "TokenUsage_traceId_idx" ON "TokenUsage"("traceId");
CREATE INDEX "RouteOutcome_traceId_idx" ON "RouteOutcome"("traceId");
CREATE INDEX "AdapterRunTelemetry_traceId_idx" ON "AdapterRunTelemetry"("traceId");
CREATE INDEX "RouteDecisionLog_traceId_idx" ON "RouteDecisionLog"("traceId");
CREATE INDEX "RouteDecisionLog_designRevision_createdAt_idx"
  ON "RouteDecisionLog"("designRevision", "createdAt");
