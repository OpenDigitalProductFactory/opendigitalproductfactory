-- BI-C64EDA33 (plan 2026-11-14-workroom-runtime-core, decisions DI-BEAADBEEB92C
-- and DI-1B6A408A5F4F): the Workroom runtime's transactional outbox. A runtime
-- command's decision inserts its effects in the same transaction as its log
-- rows, its runtimeSession record and its receipt; the leased effect worker
-- runs them in per-room order and reports each result back as a command.
-- Additive: a new enum pair and a new, empty table. Safe against any data
-- state and re-runnable.
DO $$ BEGIN
  CREATE TYPE "WorkroomEffectKind" AS ENUM ('start-turn', 'steer-turn', 'interrupt-turn', 'answer-request', 'hold-request',
    'close-session', 'revoke-token', 'announce-supervision-lost', 'record-plan-limit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WorkroomEffectStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'retired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "WorkroomEffect" (
    "id" TEXT NOT NULL,
    "workCapsuleId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "kind" "WorkroomEffectKind" NOT NULL,
    "processBound" BOOLEAN NOT NULL DEFAULT false,
    "sessionGeneration" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "WorkroomEffectStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "WorkroomEffect_pkey" PRIMARY KEY ("id")
);

-- @migration-safety: data-safe: the table is created empty by this migration, so no existing row can violate the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "WorkroomEffect_workCapsuleId_commandId_ordinal_key"
  ON "WorkroomEffect"("workCapsuleId", "commandId", "ordinal");
CREATE INDEX IF NOT EXISTS "WorkroomEffect_status_availableAt_idx" ON "WorkroomEffect"("status", "availableAt");
CREATE INDEX IF NOT EXISTS "WorkroomEffect_workCapsuleId_status_sequence_idx" ON "WorkroomEffect"("workCapsuleId", "status", "sequence");
CREATE INDEX IF NOT EXISTS "WorkroomEffect_createdAt_idx" ON "WorkroomEffect"("createdAt");

DO $$ BEGIN
  ALTER TABLE "WorkroomEffect" ADD CONSTRAINT "WorkroomEffect_workCapsuleId_fkey"
    FOREIGN KEY ("workCapsuleId") REFERENCES "WorkCapsule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
