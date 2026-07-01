-- Recurring work-capture primitive (BI-4C5F7A2D, spec 2026-07-01). Additive only:
-- RecurrenceSchedule + WorkEngagement (+ self-relation instances) +
-- WorkEngagementActivity, plus a typed FK from ScheduledOutboundAction to the
-- engagement instance it executes.

-- CreateTable
CREATE TABLE "RecurrenceSchedule" (
    "id" TEXT NOT NULL,
    "rrule" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "until" TIMESTAMP(3),
    "misfirePolicy" TEXT NOT NULL DEFAULT 'skip',
    "supersededByScheduleId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurrenceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkEngagement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "title" TEXT NOT NULL,
    "requestedOutcome" TEXT,
    "createdByAgentId" TEXT,
    "recurrenceScheduleId" TEXT,
    "parentWorkEngagementId" TEXT,
    "instanceNumber" INTEGER,
    "occurrenceAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "exceptionState" TEXT NOT NULL DEFAULT 'none',
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkEngagementActivity" (
    "id" TEXT NOT NULL,
    "workEngagementId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "recordedByAgentId" TEXT,
    "toolExecutionId" TEXT,

    CONSTRAINT "WorkEngagementActivity_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ScheduledOutboundAction" ADD COLUMN     "workEngagementInstanceId" TEXT;

-- CreateIndex
CREATE INDEX "RecurrenceSchedule_active_idx" ON "RecurrenceSchedule"("active");

-- CreateIndex
CREATE INDEX "RecurrenceSchedule_supersededByScheduleId_idx" ON "RecurrenceSchedule"("supersededByScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkEngagement_recurrenceScheduleId_occurrenceAt_key" ON "WorkEngagement"("recurrenceScheduleId", "occurrenceAt");

-- CreateIndex
CREATE INDEX "WorkEngagement_organizationId_status_createdAt_idx" ON "WorkEngagement"("organizationId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WorkEngagement_parentWorkEngagementId_idx" ON "WorkEngagement"("parentWorkEngagementId");

-- CreateIndex
CREATE INDEX "WorkEngagement_dueAt_idx" ON "WorkEngagement"("dueAt");

-- CreateIndex
CREATE INDEX "WorkEngagement_status_idx" ON "WorkEngagement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkEngagementActivity_workEngagementId_seq_key" ON "WorkEngagementActivity"("workEngagementId", "seq");

-- CreateIndex
CREATE INDEX "WorkEngagementActivity_workEngagementId_recordedAt_idx" ON "WorkEngagementActivity"("workEngagementId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "WorkEngagementActivity_kind_recordedAt_idx" ON "WorkEngagementActivity"("kind", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "ScheduledOutboundAction_workEngagementInstanceId_idx" ON "ScheduledOutboundAction"("workEngagementInstanceId");

-- AddForeignKey
ALTER TABLE "RecurrenceSchedule" ADD CONSTRAINT "RecurrenceSchedule_supersededByScheduleId_fkey" FOREIGN KEY ("supersededByScheduleId") REFERENCES "RecurrenceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkEngagement" ADD CONSTRAINT "WorkEngagement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkEngagement" ADD CONSTRAINT "WorkEngagement_recurrenceScheduleId_fkey" FOREIGN KEY ("recurrenceScheduleId") REFERENCES "RecurrenceSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkEngagement" ADD CONSTRAINT "WorkEngagement_parentWorkEngagementId_fkey" FOREIGN KEY ("parentWorkEngagementId") REFERENCES "WorkEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkEngagementActivity" ADD CONSTRAINT "WorkEngagementActivity_workEngagementId_fkey" FOREIGN KEY ("workEngagementId") REFERENCES "WorkEngagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledOutboundAction" ADD CONSTRAINT "ScheduledOutboundAction_workEngagementInstanceId_fkey" FOREIGN KEY ("workEngagementInstanceId") REFERENCES "WorkEngagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
