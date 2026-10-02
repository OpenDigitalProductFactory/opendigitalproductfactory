-- BI-F9EE05E5 (activity quiescence spec §11a): an operator Abort of a
-- self-upgrade drain is recorded durably on the run, mirroring
-- shipForceEscalatedAt/By (Force now). The coordinator reads it on every check,
-- so an Abort whose wake-up event the job engine dropped still ends the drain.
--
-- Forward-only and additive. Both columns are nullable and never backfilled:
-- no historical run carries an abort request, and NULL means "no Abort was
-- pressed". IF NOT EXISTS keeps a re-run harmless against any data state.
ALTER TABLE "QuiescenceRun" ADD COLUMN IF NOT EXISTS "abortRequestedAt" TIMESTAMP(3);
ALTER TABLE "QuiescenceRun" ADD COLUMN IF NOT EXISTS "abortRequestedBy" TEXT;
