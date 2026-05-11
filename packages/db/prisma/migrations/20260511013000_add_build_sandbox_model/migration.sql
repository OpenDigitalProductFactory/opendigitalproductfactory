-- Add first-class Build Studio sandbox execution records.
-- This is additive and does not replace SandboxSlot lease state.

CREATE TABLE "Sandbox" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "agentId" TEXT,
    "portalInstanceId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "destroyedAt" TIMESTAMP(3),
    "previewUrl" TEXT,
    "capabilitiesSnapshot" JSONB NOT NULL,

    CONSTRAINT "Sandbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Sandbox_buildId_idx" ON "Sandbox"("buildId");
CREATE INDEX "Sandbox_state_startedAt_idx" ON "Sandbox"("state", "startedAt");

ALTER TABLE "Sandbox" ADD CONSTRAINT "Sandbox_buildId_fkey"
    FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId")
    ON DELETE CASCADE ON UPDATE CASCADE;
