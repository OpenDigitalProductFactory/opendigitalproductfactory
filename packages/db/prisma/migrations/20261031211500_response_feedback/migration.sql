-- @migration-safety: data-safe: New foreign-key columns are nullable and initially NULL, with no backfill. Every existing row satisfies the added keys; revision defaults to0.
-- Additive exact-response feedback. No inference/backfill of historical attribution.
CREATE TYPE "ResponseFeedbackScope" AS ENUM ('known_unroomed', 'workroom');
CREATE TYPE "ResponseFeedbackSource" AS ENUM ('human', 'agent');

ALTER TABLE "AgentMessage"
  ADD COLUMN "responseAttemptId" TEXT,
  ADD COLUMN "responseContentDigest" TEXT,
  ADD COLUMN "responseScope" "ResponseFeedbackScope",
  ADD COLUMN "responseWorkroomId" TEXT;
ALTER TABLE "AdapterRunTelemetry"
  ADD COLUMN "feedbackPrincipalId" TEXT,
  ADD COLUMN "feedbackSource" "ResponseFeedbackSource",
  ADD COLUMN "feedbackRevision" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "AgentMessage_responseAttemptId_idx" ON "AgentMessage"("responseAttemptId");
CREATE INDEX "AgentMessage_responseWorkroomId_idx" ON "AgentMessage"("responseWorkroomId");
CREATE INDEX "AdapterRunTelemetry_feedbackPrincipalId_idx" ON "AdapterRunTelemetry"("feedbackPrincipalId");

ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_responseWorkroomId_fkey"
  FOREIGN KEY ("responseWorkroomId") REFERENCES "WorkCapsule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdapterRunTelemetry" ADD CONSTRAINT "AdapterRunTelemetry_feedbackPrincipalId_fkey"
  FOREIGN KEY ("feedbackPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
