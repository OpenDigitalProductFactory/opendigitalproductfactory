-- EP-B70E718D F2 (BI-4ADFFEDB): Workroom stages report into the shared queue
-- flow telemetry. A stage's time interleaves work with waiting on a person or a
-- blockage, so its snapshot carries held time and the share of cycle time that
-- was touch time (flow efficiency).
--
-- Additive and nullable: existing rows keep their values and read NULL for the
-- new columns, which is what a queue that never holds reports. Safe against any
-- data state; no backfill needed.
ALTER TABLE "QueueMetricSnapshot" ADD COLUMN IF NOT EXISTS "heldP50Ms" INTEGER;
ALTER TABLE "QueueMetricSnapshot" ADD COLUMN IF NOT EXISTS "heldP95Ms" INTEGER;
ALTER TABLE "QueueMetricSnapshot" ADD COLUMN IF NOT EXISTS "processShare" DOUBLE PRECISION;
