-- BI-4ADFFEDB (EP-B70E718D): QueueMetricSnapshot stores durations in
-- milliseconds as INTEGER, which caps at 2,147,483,647 ms (about 24.8 days).
-- Workroom stages are queues whose items legitimately sit for weeks, and on the
-- live install the hourly rollup failed with "value 2430001060 is out of range
-- for type integer" (28 days held). Widen every duration column to DOUBLE
-- PRECISION: exact for whole milliseconds far beyond any duration (2^53), and
-- the application keeps reading a plain number.
--
-- Safe against any data state: INTEGER converts to DOUBLE PRECISION without
-- loss, NULL stays NULL, and re-running is a no-op on an already-widened column.
ALTER TABLE "QueueMetricSnapshot"
  ALTER COLUMN "waitP50Ms" TYPE DOUBLE PRECISION USING "waitP50Ms"::double precision,
  ALTER COLUMN "waitP95Ms" TYPE DOUBLE PRECISION USING "waitP95Ms"::double precision,
  ALTER COLUMN "processP50Ms" TYPE DOUBLE PRECISION USING "processP50Ms"::double precision,
  ALTER COLUMN "processP95Ms" TYPE DOUBLE PRECISION USING "processP95Ms"::double precision,
  ALTER COLUMN "cycleP50Ms" TYPE DOUBLE PRECISION USING "cycleP50Ms"::double precision,
  ALTER COLUMN "cycleP95Ms" TYPE DOUBLE PRECISION USING "cycleP95Ms"::double precision,
  ALTER COLUMN "heldP50Ms" TYPE DOUBLE PRECISION USING "heldP50Ms"::double precision,
  ALTER COLUMN "heldP95Ms" TYPE DOUBLE PRECISION USING "heldP95Ms"::double precision;
