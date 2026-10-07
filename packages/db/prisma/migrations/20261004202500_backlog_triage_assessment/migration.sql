-- Expand only: prior rows are eligible once; rollback leaves recorded state.
DO $$ BEGIN
  CREATE TYPE "BacklogTriageAssessmentOutcome" AS ENUM ('autoBuilt', 'needsReview', 'lowConfidence', 'invalidResponse', 'modelError', 'ledgerError', 'applyError', 'changed', 'inFlight');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "BacklogItem"
  ADD COLUMN IF NOT EXISTS "triageAssessmentFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "triageAssessmentOutcome" "BacklogTriageAssessmentOutcome",
  ADD COLUMN IF NOT EXISTS "triageAssessmentAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "triageAssessmentRetryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "triageAssessmentClaim" TEXT,
  ADD COLUMN IF NOT EXISTS "triageAssessedAt" TIMESTAMP(3);
ALTER TABLE "ScheduledJob" ADD COLUMN IF NOT EXISTS "lastRunSummary" TEXT, ADD COLUMN IF NOT EXISTS "runCursor" TEXT;
