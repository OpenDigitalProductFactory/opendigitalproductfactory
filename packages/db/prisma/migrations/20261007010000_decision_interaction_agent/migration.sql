-- BI-6082C235 (EP-DECISION-OUTCOME-LOOP slice 2). Say which coworker made a
-- governed decision.
--
-- DecisionInteraction carried a profile, the human who triggered it, a domain
-- and a risk tier, but no agent. The shadow ledger and TrustState key on
-- agentId x activityType x riskClass, so not one decision could be attributed
-- to a coworker: the ledger held 0 rows beside 2,265 decisions on the operator
-- install where this was measured.
--
-- The id was not missing, only misplaced. principle_decide has recorded it in
-- outcomePayload.caller.agentId since BI-0EEBA669 (872 of 2,265 rows there).
-- This is the fourth value in this table to sit in a JSON blob beside the
-- column that should hold it (recommendedOptionId, subject and autonomous were
-- the first three).
--
-- The backfill invents nothing. It copies the recorded id, and only where an
-- Agent row carries exactly that id, so the foreign key can never point at a
-- coworker that does not exist. No agent is derived from a task run or from
-- the question text. A row whose payload names no agent, or names one that no
-- longer exists, stays NULL, which is the honest state. Idempotent: only NULL
-- columns are touched, so a re-run reports UPDATE 0.

ALTER TABLE "DecisionInteraction" ADD COLUMN IF NOT EXISTS "agentId" TEXT;

CREATE INDEX IF NOT EXISTS "DecisionInteraction_agentId_createdAt_idx"
  ON "DecisionInteraction" ("agentId", "createdAt");

-- @migration-safety: data-safe: the column is added in this same migration and is NULL on every row when the constraint is created; the backfill below writes only ids an Agent row carries.
DO $$ BEGIN
  ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE "DecisionInteraction" AS d
SET "agentId" = a."agentId"
FROM "Agent" AS a
WHERE d."agentId" IS NULL
  AND a."agentId" = d."outcomePayload" -> 'caller' ->> 'agentId';
