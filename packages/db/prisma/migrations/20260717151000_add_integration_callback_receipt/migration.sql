-- Durable idempotency and dispatch-recovery state for connector callbacks.
-- Raw callback payloads, signatures, and credentials are intentionally absent.

-- CreateTable
CREATE TABLE "IntegrationCallbackReceipt" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "responseCode" INTEGER,
    "domainEntityId" TEXT,
    "acknowledgment" JSONB,
    "dispatchPending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationCallbackReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCallbackReceipt_connectorId_deliveryKey_key"
ON "IntegrationCallbackReceipt"("connectorId", "deliveryKey");

-- CreateIndex
CREATE INDEX "IntegrationCallbackReceipt_status_dispatchPending_updatedAt_idx"
ON "IntegrationCallbackReceipt"("status", "dispatchPending", "updatedAt");

-- CreateIndex
CREATE INDEX "IntegrationCallbackReceipt_connectorId_createdAt_idx"
ON "IntegrationCallbackReceipt"("connectorId", "createdAt");
