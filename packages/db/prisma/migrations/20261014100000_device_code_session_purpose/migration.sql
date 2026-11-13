-- BI-985F4EC9: a GitHub device-flow login records which credential slot its
-- token is for. Design: docs/superpowers/specs/2026-10-14-managed-repository-connection-at-setup-design.md §3.3, §5.
--
-- Additive: one enum and one nullable column on "DeviceCodeSession". Existing
-- rows (short-lived, 15-minute sessions) keep NULL, which the poll reads as
-- hive contribution, the only purpose that existed before. No backfill.
-- IF NOT EXISTS / duplicate_object guards make a re-run harmless.

DO $$ BEGIN
    CREATE TYPE "GitHubDeviceFlowPurpose" AS ENUM ('hive-contribution', 'repository-controller');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "DeviceCodeSession" ADD COLUMN IF NOT EXISTS "purpose" "GitHubDeviceFlowPurpose";
