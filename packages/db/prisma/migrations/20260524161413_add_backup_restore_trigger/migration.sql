-- Backfill-safe addition: existing rows get NULL, application code treats
-- NULL as "operator-restore" (pre-BI-31C9FBDF default).
--
-- BI-31C9FBDF (EP-DR-HARDENING-2026-05-23): distinguish operator-triggered
-- restores from automated nightly trial-verifications so the readiness card
-- + metrics can split the two surfaces.
ALTER TABLE "BackupRestore" ADD COLUMN "trigger" TEXT;
CREATE INDEX "BackupRestore_trigger_idx" ON "BackupRestore"("trigger");
