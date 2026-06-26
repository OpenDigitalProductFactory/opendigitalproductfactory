-- DB hot-path (BI-OPT-DB-HOTPATH): BacklogItem.status had NO index, yet status is
-- filtered at the hot feed/selector sites (backlog-selector, activity-feed-data,
-- remediation-teeup). Add a single-column index for equality/IN filters and a
-- composite [status, updatedAt] for the selector's status-filtered, updatedAt-ordered
-- reads. Additive index-only migration — no data change.

-- CreateIndex
CREATE INDEX "BacklogItem_status_idx" ON "BacklogItem"("status");

-- CreateIndex
CREATE INDEX "BacklogItem_status_updatedAt_idx" ON "BacklogItem"("status", "updatedAt");
