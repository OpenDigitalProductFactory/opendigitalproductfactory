-- BI-97C56E20 (closure scorecard): indexes for the daily bounded read.
-- Independent review of PR #7229 required every scorecard query to read through
-- an index. These four were missing; every other read uses an existing status
-- or phase index. Additive only: no column or data changes, safe against any
-- data state and re-runnable.

-- Owner-attention asks raised in the window.
CREATE INDEX IF NOT EXISTS "PlatformIssueReport_createdAt_idx" ON "PlatformIssueReport"("createdAt");

-- Held owner-attention reports and their oldest age.
CREATE INDEX IF NOT EXISTS "PlatformIssueReport_status_createdAt_idx" ON "PlatformIssueReport"("status", "createdAt");

-- Decisions made in the window.
CREATE INDEX IF NOT EXISTS "DecisionInteraction_createdAt_idx" ON "DecisionInteraction"("createdAt");

-- Self-filed (automated-detection) items by state. No existing index leads on source.
CREATE INDEX IF NOT EXISTS "BacklogItem_source_status_idx" ON "BacklogItem"("source", "status");
