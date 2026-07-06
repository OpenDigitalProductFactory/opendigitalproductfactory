-- EP-3516E23D Phase 1 — reusable queueing substrate shared flow-telemetry spine.
-- Two brand-new tables only. No ALTER of any existing table, no tightening DDL
-- on existing data → data-safe by construction (fresh tables have no rows).

-- CreateTable
CREATE TABLE "QueueTelemetryEvent" (
    "id" TEXT NOT NULL,
    "queueKey" TEXT NOT NULL,
    "itemKind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "transition" TEXT NOT NULL,
    "outcome" TEXT,
    "laneKey" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueTelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueMetricSnapshot" (
    "id" TEXT NOT NULL,
    "queueKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "wip" INTEGER NOT NULL DEFAULT 0,
    "arrivals" INTEGER NOT NULL DEFAULT 0,
    "throughput" INTEGER NOT NULL DEFAULT 0,
    "waitP50Ms" INTEGER,
    "waitP95Ms" INTEGER,
    "processP50Ms" INTEGER,
    "processP95Ms" INTEGER,
    "cycleP50Ms" INTEGER,
    "cycleP95Ms" INTEGER,
    "firstPassYield" DOUBLE PRECISION,
    "slaAttainment" DOUBLE PRECISION,
    "abandonmentRate" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueueTelemetryEvent_queueKey_occurredAt_idx" ON "QueueTelemetryEvent"("queueKey", "occurredAt");

-- CreateIndex
CREATE INDEX "QueueTelemetryEvent_itemKind_itemId_idx" ON "QueueTelemetryEvent"("itemKind", "itemId");

-- CreateIndex
CREATE INDEX "QueueTelemetryEvent_occurredAt_idx" ON "QueueTelemetryEvent"("occurredAt");

-- CreateIndex
-- @migration-safety: data-safe: QueueMetricSnapshot is created empty in this same migration, so the unique index over (queueKey, period) has no existing rows to conflict with.
CREATE UNIQUE INDEX "QueueMetricSnapshot_queueKey_period_key" ON "QueueMetricSnapshot"("queueKey", "period");

-- CreateIndex
CREATE INDEX "QueueMetricSnapshot_queueKey_period_idx" ON "QueueMetricSnapshot"("queueKey", "period");

-- CreateIndex
CREATE INDEX "QueueMetricSnapshot_period_idx" ON "QueueMetricSnapshot"("period");
