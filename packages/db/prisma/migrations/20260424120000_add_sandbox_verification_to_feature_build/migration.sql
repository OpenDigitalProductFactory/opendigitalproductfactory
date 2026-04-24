-- Add sandbox typecheck + build verification results to FeatureBuild.
-- Persisted by build-review-verification Inngest function (#212).
-- checkPhaseGate reads both columns to block review -> ship when the
-- sandbox is red.

ALTER TABLE "FeatureBuild"
  ADD COLUMN "sandboxVerification" JSONB,
  ADD COLUMN "sandboxVerificationStatus" TEXT;
