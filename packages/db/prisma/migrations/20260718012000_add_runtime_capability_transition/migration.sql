CREATE TABLE "RuntimeCapabilityTransition" (
    "id" TEXT NOT NULL,
    "transitionId" TEXT NOT NULL,
    "previousKeys" TEXT[] NOT NULL,
    "desiredKeys" TEXT[] NOT NULL,
    "previousStateHash" TEXT NOT NULL,
    "desiredStateHash" TEXT NOT NULL,
    "catalogHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "hostReceipt" JSONB,
    "failure" JSONB,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hostAppliedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RuntimeCapabilityTransition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RuntimeCapabilityTransition_status_check" CHECK ("status" IN ('pending', 'applying', 'host_applied', 'succeeded', 'failed', 'compensating', 'rolled_back', 'rollback_failed'))
);

CREATE UNIQUE INDEX "RuntimeCapabilityTransition_transitionId_key" ON "RuntimeCapabilityTransition"("transitionId");
CREATE INDEX "RuntimeCapabilityTransition_status_createdAt_idx" ON "RuntimeCapabilityTransition"("status", "createdAt");
CREATE UNIQUE INDEX "RuntimeCapabilityTransition_one_active_idx"
  ON "RuntimeCapabilityTransition" ((1))
  WHERE "status" IN ('pending', 'applying', 'host_applied', 'compensating');
