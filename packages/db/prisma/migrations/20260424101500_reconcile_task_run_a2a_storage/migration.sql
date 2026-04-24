ALTER TABLE "TaskRun"
ALTER COLUMN "status" SET DEFAULT 'submitted';

UPDATE "TaskRun"
SET "status" = CASE
  WHEN "state" = 'submitted' THEN 'submitted'
  WHEN "state" = 'working' THEN 'working'
  WHEN "state" = 'input-required' THEN 'input-required'
  WHEN "state" = 'auth-required' THEN 'auth-required'
  WHEN "state" = 'completed' THEN 'completed'
  WHEN "state" = 'failed' THEN 'failed'
  WHEN "state" = 'canceled' THEN 'canceled'
  WHEN "state" = 'rejected' THEN 'rejected'
  WHEN "status" = 'active' THEN 'working'
  WHEN "status" = 'awaiting_human' THEN 'input-required'
  WHEN "status" = 'cancelled' THEN 'canceled'
  ELSE "status"
END;

UPDATE "TaskRun"
SET "authorityScope" = "governanceEnvelope"
WHERE "authorityScope" IS NULL
  AND "governanceEnvelope" IS NOT NULL;

DROP INDEX IF EXISTS "TaskRun_state_idx";

ALTER TABLE "TaskRun"
DROP COLUMN IF EXISTS "state",
DROP COLUMN IF EXISTS "governanceEnvelope";
