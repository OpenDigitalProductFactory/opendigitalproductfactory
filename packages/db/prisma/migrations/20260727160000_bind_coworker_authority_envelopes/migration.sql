-- Expand-only authority envelope binding. Every new column is nullable so
-- existing envelopes remain valid and no fleet data can violate the change.
-- @migration-safety: data-safe: nullable columns and indexes only; the optional
-- unique fingerprint has no pre-existing non-null values.
ALTER TABLE "CoworkerActionEnvelope"
  ADD COLUMN "taskRunId" TEXT,
  ADD COLUMN "delegationChainId" TEXT,
  ADD COLUMN "authorityDecisionId" TEXT,
  ADD COLUMN "inputFingerprint" TEXT,
  ADD COLUMN "approvalBindingFingerprint" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "CoworkerActionEnvelope_approvalBindingFingerprint_idx"
  ON "CoworkerActionEnvelope"("approvalBindingFingerprint");
CREATE UNIQUE INDEX "CoworkerActionEnvelope_active_approval_binding_key"
  ON "CoworkerActionEnvelope"("approvalBindingFingerprint")
  WHERE "status" IN ('proposed', 'approved');
CREATE INDEX "CoworkerActionEnvelope_taskRunId_idx"
  ON "CoworkerActionEnvelope"("taskRunId");
CREATE INDEX "CoworkerActionEnvelope_delegationChainId_idx"
  ON "CoworkerActionEnvelope"("delegationChainId");
CREATE INDEX "CoworkerActionEnvelope_authorityDecisionId_idx"
  ON "CoworkerActionEnvelope"("authorityDecisionId");
CREATE INDEX "CoworkerActionEnvelope_expiresAt_idx"
  ON "CoworkerActionEnvelope"("expiresAt");

ALTER TABLE "CoworkerActionEnvelope"
  ADD CONSTRAINT "CoworkerActionEnvelope_taskRunId_fkey"
  FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("taskRunId")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CoworkerActionEnvelope"
  ADD CONSTRAINT "CoworkerActionEnvelope_authorityDecisionId_fkey"
  FOREIGN KEY ("authorityDecisionId") REFERENCES "AuthorizationDecisionLog"("decisionId")
  ON DELETE SET NULL ON UPDATE CASCADE;
