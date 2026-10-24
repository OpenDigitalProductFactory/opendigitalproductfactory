-- BI-218EC195: the WWWD fallback decision profile shipped as a profile row with
-- no version row on installs seeded before the version was ensured. The
-- kernel-consult ledger refuses to record a decision against a profile with no
-- version, so every principle_decide that resolved to the fallback returned
-- ledger.recorded=false (profile-not-provisioned). Backfill the v1 version and
-- point the profile at it. Idempotent: no-op where the version already exists
-- or the profile is absent.
INSERT INTO "DecisionPerspectiveProfileVersion" ("id", "versionId", "profileId", "versionNumber", "materialFingerprint", "changeSummary", "createdAt")
SELECT
  'dppv_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  'dpf-organizational-principles-v1',
  'dpf-organizational-principles',
  1,
  'seed:dpf-organizational-principles:v1',
  'Initial organizational principle fallback profile.',
  now()
WHERE EXISTS (SELECT 1 FROM "DecisionPerspectiveProfile" WHERE "profileId" = 'dpf-organizational-principles')
  AND NOT EXISTS (SELECT 1 FROM "DecisionPerspectiveProfileVersion" WHERE "versionId" = 'dpf-organizational-principles-v1');

UPDATE "DecisionPerspectiveProfile"
SET "currentVersionId" = 'dpf-organizational-principles-v1'
WHERE "profileId" = 'dpf-organizational-principles'
  AND "currentVersionId" IS NULL
  AND EXISTS (SELECT 1 FROM "DecisionPerspectiveProfileVersion" WHERE "versionId" = 'dpf-organizational-principles-v1');
