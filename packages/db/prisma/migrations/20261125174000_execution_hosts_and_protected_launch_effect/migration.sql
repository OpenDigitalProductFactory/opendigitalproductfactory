-- BI-5A866218: immutable-identity host registrations, not route qualification.
-- BI-AFF3F2BD's issuer-owned record references this registration when issued.
CREATE TABLE IF NOT EXISTS "ExecutionHost" (
  "id" TEXT NOT NULL,
  "installationRef" TEXT NOT NULL,
  "hostRef" TEXT NOT NULL,
  "receiverRef" TEXT NOT NULL,
  "loopbackEndpointRef" TEXT,
  "tailnetEndpointRef" TEXT,
  "httpsEndpointRef" TEXT,
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastObservedAt" TIMESTAMP(3) NOT NULL,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "ExecutionHost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionHost_installationRef_hostRef_key" ON "ExecutionHost"("installationRef", "hostRef");
CREATE INDEX IF NOT EXISTS "ExecutionHost_installationRef_retiredAt_idx" ON "ExecutionHost"("installationRef", "retiredAt");

-- No producer may write this kind until older Workroom readers are drained.
ALTER TYPE "WorkroomEffectKind" ADD VALUE IF NOT EXISTS 'launch-protected-session';
