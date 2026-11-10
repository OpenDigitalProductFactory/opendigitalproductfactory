-- TableGrowthSample — nightly per-table size/growth sample taken by the Data
-- Architect steward (EP-A33A5C61 slice 5, BI-592F1E7E). Until now nothing in
-- the platform measured pg_class over time, so an unbounded table was found
-- only by a human at psql. Declared telemetry-bounded, 90 days, in the schema.

CREATE TABLE "TableGrowthSample" (
  "id" TEXT NOT NULL,
  "table" TEXT NOT NULL,
  "model" TEXT,
  "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalBytes" BIGINT NOT NULL,
  "heapBytes" BIGINT NOT NULL,
  "indexBytes" BIGINT NOT NULL,
  "toastBytes" BIGINT NOT NULL,
  "liveRows" BIGINT NOT NULL,
  "deadRows" BIGINT NOT NULL,
  "rowsLast24h" INTEGER,
  "declaredRetention" TEXT,
  CONSTRAINT "TableGrowthSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TableGrowthSample_table_sampledAt_idx" ON "TableGrowthSample"("table", "sampledAt");
CREATE INDEX "TableGrowthSample_sampledAt_idx" ON "TableGrowthSample"("sampledAt");

-- @migration-safety: data-safe: additive — a new, initially empty table; no
-- existing row, column, or enum value is touched.
