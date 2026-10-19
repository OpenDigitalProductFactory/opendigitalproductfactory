-- Owned durable-job engine tables (plan 2026-09-08 M3 phase 2, BI-85E6EF14).
-- Spec: docs/superpowers/specs/2026-09-25-postgres-durable-job-engine-design.md §5.2.
--
-- Additive only: one enum and six new tables that nothing existing references.
-- functionKey and stepKey are names from code, not row ids, so they carry no FK.
-- No backfill: every function stays on Inngest until DPF_JOBS_ENGINE routes it
-- here. IF NOT EXISTS and duplicate_object guards make a re-run harmless, so the
-- migration applies cleanly against any existing data state.

DO $$ BEGIN
    CREATE TYPE "JobRunStatus" AS ENUM ('queued', 'running', 'sleeping', 'waiting', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "JobEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "ts" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fannedOutAt" TIMESTAMP(3),

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobRun" (
    "id" TEXT NOT NULL,
    "functionKey" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" JSONB NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobStep" (
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "output" JSONB,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobStep_pkey" PRIMARY KEY ("runId","stepKey")
);

CREATE TABLE IF NOT EXISTS "JobWait" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "matchExpr" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobWait_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobConcurrencySlot" (
    "laneKey" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "runId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobConcurrencySlot_pkey" PRIMARY KEY ("laneKey","slot")
);

CREATE TABLE IF NOT EXISTS "JobCronState" (
    "functionKey" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "nextFireAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCronState_pkey" PRIMARY KEY ("functionKey")
);

CREATE INDEX IF NOT EXISTS "JobEvent_name_receivedAt_idx" ON "JobEvent"("name", "receivedAt");

CREATE INDEX IF NOT EXISTS "JobEvent_receivedAt_idx" ON "JobEvent"("receivedAt");

CREATE INDEX IF NOT EXISTS "JobEvent_fannedOutAt_receivedAt_idx" ON "JobEvent"("fannedOutAt", "receivedAt");

CREATE INDEX IF NOT EXISTS "JobRun_status_runAfter_idx" ON "JobRun"("status", "runAfter");

CREATE INDEX IF NOT EXISTS "JobRun_status_leaseExpiresAt_idx" ON "JobRun"("status", "leaseExpiresAt");

CREATE INDEX IF NOT EXISTS "JobRun_status_finishedAt_idx" ON "JobRun"("status", "finishedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "JobRun_functionKey_eventId_key" ON "JobRun"("functionKey", "eventId");

CREATE INDEX IF NOT EXISTS "JobRun_eventId_idx" ON "JobRun"("eventId");

CREATE INDEX IF NOT EXISTS "JobWait_eventName_idx" ON "JobWait"("eventName");

CREATE INDEX IF NOT EXISTS "JobWait_expiresAt_idx" ON "JobWait"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "JobWait_runId_stepKey_key" ON "JobWait"("runId", "stepKey");

CREATE INDEX IF NOT EXISTS "JobConcurrencySlot_runId_idx" ON "JobConcurrencySlot"("runId");

CREATE INDEX IF NOT EXISTS "JobCronState_nextFireAt_idx" ON "JobCronState"("nextFireAt");

DO $$ BEGIN
    ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "JobEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "JobStep" ADD CONSTRAINT "JobStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "JobRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "JobWait" ADD CONSTRAINT "JobWait_runId_fkey" FOREIGN KEY ("runId") REFERENCES "JobRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "JobConcurrencySlot" ADD CONSTRAINT "JobConcurrencySlot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "JobRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
