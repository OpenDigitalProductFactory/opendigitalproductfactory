-- BusinessMetricRollup is introduced by the immediately preceding unpublished
-- migration. Keep that committed migration immutable and tighten its two closed
-- axes forward-only so Prisma and PostgreSQL enforce the canonical value sets.
CREATE TYPE "BusinessMetricAvailability" AS ENUM ('available', 'unavailable');
CREATE TYPE "PerformanceMetricUnit" AS ENUM ('count', 'currency', 'percent', 'rate', 'duration');

ALTER TABLE "BusinessMetricRollup"
  ALTER COLUMN "availability" TYPE "BusinessMetricAvailability"
  USING ("availability"::"BusinessMetricAvailability"),
  ALTER COLUMN "unit" TYPE "PerformanceMetricUnit"
  USING ("unit"::"PerformanceMetricUnit");
