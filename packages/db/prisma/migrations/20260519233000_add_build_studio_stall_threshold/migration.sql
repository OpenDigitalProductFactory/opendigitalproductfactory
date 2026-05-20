-- BI-4ab6be39 stall detection — per-phase timeout thresholds.
-- See docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md §7.2.
CREATE TABLE "BuildStudioStallThreshold" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "heartbeatTimeoutSeconds" INTEGER NOT NULL,
    "totalPhaseTimeoutSeconds" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "BuildStudioStallThreshold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuildStudioStallThreshold_scope_key" ON "BuildStudioStallThreshold"("scope");

CREATE INDEX "BuildStudioStallThreshold_scope_idx" ON "BuildStudioStallThreshold"("scope");
