-- BI-00C68162: who supplied a backlog item's demand value inputs.
-- Expand only and idempotent: three nullable columns on an enum that already
-- exists (EstimateSource, 20260712 estimate provenance). No backfill — rows
-- scored before this column stay NULL (unattributed), which is the honest
-- value: nothing recorded who entered them.
ALTER TABLE "BacklogItem"
  ADD COLUMN IF NOT EXISTS "demandInputSource" "EstimateSource",
  ADD COLUMN IF NOT EXISTS "demandInputById" TEXT,
  ADD COLUMN IF NOT EXISTS "demandInputAt" TIMESTAMP(3);
