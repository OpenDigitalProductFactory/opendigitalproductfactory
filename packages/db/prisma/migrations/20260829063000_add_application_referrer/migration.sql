-- BI-D78DC392, D6 of EP-862820FD: a referral becomes an evidenced relationship.
--
-- RecruitingSource.type already accepts the string "referral", so the platform
-- could record that an application ARRIVED through a referral. Nothing recorded
-- WHO referred whom. A category cannot be excluded from an approval chain; a
-- person can, and must be.
--
-- Nullable with no backfill. Historical applications genuinely have no recorded
-- referrer, and inferring one from RecruitingSource.type would invent a
-- relationship that carries a bonus entitlement and a conflict-of-interest
-- exclusion. Unknown stays unknown.
--
-- ON DELETE SET NULL, not CASCADE: deleting an employee must never delete a
-- candidate's application. The referral fact is lost, the application is not.
--
-- STRUCTURAL SEPARATION (the guarantee this column depends on): this table gets
-- exactly ONE new foreign key, to EmployeeProfile. It gains no relation to any
-- scoring, evaluation or ranking model. Referral pipelines reproduce the
-- existing demographic shape of a workforce, which is precisely the adverse
-- impact ProtectedMonitoringObservation was built to measure - so monitoring
-- reaches that rail only through its opaque evaluationRef, never through a join.
-- A relation added here later "for convenience" would silently destroy that.

ALTER TABLE "Application" ADD COLUMN "referredByEmployeeProfileId" TEXT;

CREATE INDEX "Application_referredByEmployeeProfileId_idx"
  ON "Application"("referredByEmployeeProfileId");

-- @migration-safety: data-safe: referredByEmployeeProfileId is added NULL in this same migration, so every existing row is NULL and a NULL value cannot violate a foreign key. There is no pre-existing data to remediate and nothing to backfill.
ALTER TABLE "Application"
  ADD CONSTRAINT "Application_referredByEmployeeProfileId_fkey"
  FOREIGN KEY ("referredByEmployeeProfileId")
  REFERENCES "EmployeeProfile"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
