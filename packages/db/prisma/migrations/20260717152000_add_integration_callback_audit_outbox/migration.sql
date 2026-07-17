-- Safe transactional audit outbox for accepted connector callbacks.
-- auditData contains only the kernel's redacted IntegrationToolCallLog projection.

ALTER TABLE "IntegrationCallbackReceipt"
ADD COLUMN "auditPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "auditData" JSONB;

DROP INDEX "IntegrationCallbackReceipt_status_dispatchPending_updatedAt_idx";

CREATE INDEX "IntegrationCallbackReceipt_pending_idx"
ON "IntegrationCallbackReceipt"("status", "dispatchPending", "auditPending", "updatedAt");
