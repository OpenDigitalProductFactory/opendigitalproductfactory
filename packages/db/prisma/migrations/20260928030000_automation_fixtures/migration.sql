-- Additive nullable provenance; existing users remain ordinary users with NULLs.
-- @migration-safety: data-safe: Every pre-existing row receives four NULLs, satisfying CHECK; nullable FK and unique index permit those rows unchanged.
-- No backfill. Retain provenance and expiry enforcement on rollback.
CREATE TYPE "AutomationPersonaProfile" AS ENUM ('platform_manager', 'developer', 'backlog_manager', 'employee', 'developer_backlog_manager');
ALTER TABLE "User"
  ADD COLUMN "automationVerificationId" TEXT,
  ADD COLUMN "automationProfile" "AutomationPersonaProfile",
  ADD COLUMN "automationSlot" INTEGER,
  ADD COLUMN "automationExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD CONSTRAINT "User_automation_fixture_complete" CHECK (
  ("automationVerificationId" IS NULL AND "automationProfile" IS NULL AND "automationSlot" IS NULL AND "automationExpiresAt" IS NULL)
  OR ("automationVerificationId" IS NOT NULL AND "automationProfile" IS NOT NULL AND "automationSlot" BETWEEN 0 AND 1 AND "automationSlot" IS NOT NULL AND "automationExpiresAt" IS NOT NULL AND NOT "isSuperuser")
);
CREATE UNIQUE INDEX "User_automation_fixture_key" ON "User"("automationVerificationId", "automationProfile", "automationSlot");
CREATE INDEX "User_automationExpiresAt_id_idx" ON "User"("automationExpiresAt", "id");
ALTER TABLE "User" ADD CONSTRAINT "User_automationVerificationId_fkey" FOREIGN KEY ("automationVerificationId") REFERENCES "RuntimeVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
