-- Add manual support-mode context for feedback triage reports.
ALTER TABLE "PlatformIssueReport"
  ADD COLUMN IF NOT EXISTS "triggerKind" TEXT,
  ADD COLUMN IF NOT EXISTS "supportSessionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformIssueReport_reportedById_supportSessionId_key"
  ON "PlatformIssueReport"("reportedById", "supportSessionId");

CREATE INDEX IF NOT EXISTS "PlatformIssueReport_reportedById_supportSessionId_createdAt_idx"
  ON "PlatformIssueReport"("reportedById", "supportSessionId", "createdAt" DESC);
