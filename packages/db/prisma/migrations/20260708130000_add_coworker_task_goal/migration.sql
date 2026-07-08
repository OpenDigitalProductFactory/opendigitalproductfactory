-- BI-D6F6A313: coworker goal / stop-condition primitive. Persists a verifiable
-- completion condition attached to a coworker so an autonomous run can be judged
-- met/unmet against it instead of self-declaring done. Additive-only.
--
-- @migration-safety: data-safe: creates one new table with FK to Agent
-- (ON DELETE CASCADE) and no changes to existing tables or rows; nothing to
-- backfill and no existing row can violate the new indexes.

CREATE TABLE "CoworkerTaskGoal" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "scheduledTaskId" TEXT,
    "condition" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMP(3),
    "verdictRationale" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CoworkerTaskGoal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoworkerTaskGoal_agentId_status_idx" ON "CoworkerTaskGoal"("agentId", "status");

CREATE INDEX "CoworkerTaskGoal_scheduledTaskId_idx" ON "CoworkerTaskGoal"("scheduledTaskId");

ALTER TABLE "CoworkerTaskGoal" ADD CONSTRAINT "CoworkerTaskGoal_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
