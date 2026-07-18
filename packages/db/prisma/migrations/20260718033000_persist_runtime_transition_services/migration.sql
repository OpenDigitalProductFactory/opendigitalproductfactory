-- The service closure is part of the immutable signed host envelope. Persist it
-- so a portal restart can verify or replay the exact request without recompiling.
ALTER TABLE "RuntimeCapabilityTransition"
  ADD COLUMN "previousServices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "desiredServices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "RuntimeCapabilityTransitionEvent" (
  "id" TEXT NOT NULL,
  "transitionId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "detail" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuntimeCapabilityTransitionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RuntimeCapabilityTransitionEvent_transitionId_fkey" FOREIGN KEY ("transitionId") REFERENCES "RuntimeCapabilityTransition"("transitionId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RuntimeCapabilityTransitionEvent_transitionId_createdAt_idx" ON "RuntimeCapabilityTransitionEvent"("transitionId", "createdAt");
