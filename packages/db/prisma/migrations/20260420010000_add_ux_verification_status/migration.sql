-- Adds FeatureBuild.uxVerificationStatus. Tracks the lifecycle of the
-- coworker-driven UX verification run independently of uxTestResults
-- (which keeps its existing UxTestStep[] shape to avoid breaking the
-- array consumers in ReviewPanel, EvidenceSummary, checkPhaseGate,
-- save_phase_handoff, and test fixtures).
--
-- Valid values (enforced by application layer, not DB):
--   null       -- verification has never been triggered
--   "running"  -- Inngest verification job is executing
--   "complete" -- all steps passed
--   "failed"   -- one or more steps failed
--   "skipped"  -- zero acceptance criteria; nothing to verify

ALTER TABLE "FeatureBuild" ADD COLUMN "uxVerificationStatus" TEXT;
