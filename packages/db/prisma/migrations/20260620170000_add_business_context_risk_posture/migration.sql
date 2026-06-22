-- EP-ONBOARDING-INTAKE P0: org-wide risk posture home on BusinessContext.
-- Structured companion to the prose howWeDecide WWWD stance. Industry sets a
-- conservative default (deriveRiskPostureDefault, mirroring INDUSTRY_RETENTION_FLOORS);
-- the operator may override. Sets the autonomy envelope (ceiling + maturation
-- rate), not the live autonomy level. Additive + nullable — no backfill needed;
-- existing installs seed a default at next setup completion. Consumers wired in P1.
ALTER TABLE "BusinessContext" ADD COLUMN "riskPosture" TEXT;
ALTER TABLE "BusinessContext" ADD COLUMN "riskPostureSource" TEXT;
ALTER TABLE "BusinessContext" ADD COLUMN "riskPostureCapturedAt" TIMESTAMP(3);
