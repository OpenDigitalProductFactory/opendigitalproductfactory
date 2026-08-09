-- MCP 2026 Tasks control state belongs on the canonical TaskRun aggregate.
-- These nullable columns are safe for every existing data state: historical
-- tasks retain the legacy user-bound authorization fallback, while newly
-- materialized MCP task handles receive an explicit caller binding.
ALTER TABLE "TaskRun"
  ADD COLUMN "mcpOwnerTokenId" TEXT,
  ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3),
  ADD COLUMN "cancellationRequestedByUserId" TEXT;

CREATE INDEX "TaskRun_mcpOwnerTokenId_status_idx"
  ON "TaskRun"("mcpOwnerTokenId", "status");

CREATE INDEX "TaskRun_status_cancellationRequestedAt_idx"
  ON "TaskRun"("status", "cancellationRequestedAt");
