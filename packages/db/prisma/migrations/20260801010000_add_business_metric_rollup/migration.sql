-- CreateTable
CREATE TABLE "BusinessMetricRollup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "dimensionsHash" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "value" DECIMAL(20,6),
    "unit" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "unavailableReason" TEXT,
    "definitionVersion" TEXT NOT NULL,
    "sourceWatermark" TIMESTAMP(3) NOT NULL,
    "sourceLineage" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessMetricRollup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BusinessMetricRollup_period_check" CHECK ("periodEnd" > "periodStart"),
    CONSTRAINT "BusinessMetricRollup_availability_check" CHECK (
      ("availability" = 'available' AND "value" IS NOT NULL AND "unavailableReason" IS NULL)
      OR
      ("availability" = 'unavailable' AND "value" IS NULL AND "unavailableReason" IS NOT NULL)
    )
);

-- @migration-safety: data-safe: BusinessMetricRollup is created empty in this migration, so its tenant/metric/period/dimensions/version identity cannot conflict with existing rows.
CREATE UNIQUE INDEX "business_metric_rollup_identity" ON "BusinessMetricRollup"("organizationId", "metricKey", "periodStart", "periodEnd", "dimensionsHash", "definitionVersion");

CREATE INDEX "BusinessMetricRollup_organizationId_periodStart_periodEnd_idx" ON "BusinessMetricRollup"("organizationId", "periodStart", "periodEnd");
CREATE INDEX "BusinessMetricRollup_organizationId_metricKey_sourceWatermark_idx" ON "BusinessMetricRollup"("organizationId", "metricKey", "sourceWatermark");

ALTER TABLE "BusinessMetricRollup" ADD CONSTRAINT "BusinessMetricRollup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
