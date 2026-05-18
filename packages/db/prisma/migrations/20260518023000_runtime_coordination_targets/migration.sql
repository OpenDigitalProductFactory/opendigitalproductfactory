-- Runtime coordination targets and typed verification timeline.
-- WorkCapsule, Sandbox, SandboxSlot, FeatureBuild, and GitPromotionCandidate
-- remain authoritative for source ownership, branch/SHA/PR, and sandbox state.

CREATE TABLE "RuntimeTarget" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "workCapsuleId" TEXT,
    "featureBuildId" TEXT,
    "sandboxId" TEXT,
    "slotId" TEXT,
    "composeProjectName" TEXT,
    "serviceName" TEXT,
    "containerName" TEXT,
    "hostUrl" TEXT,
    "internalUrl" TEXT,
    "port" INTEGER,
    "serviceVersion" TEXT,
    "acceptanceRoleOverride" TEXT,
    "debugReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuntimeTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RuntimeVerification" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "runtimeTargetId" TEXT,
    "workCapsuleId" TEXT,
    "featureBuildId" TEXT,
    "gitPromotionCandidateId" TEXT,
    "command" TEXT,
    "url" TEXT,
    "evidenceUrl" TEXT,
    "screenshotUrl" TEXT,
    "toolExecutionId" TEXT,
    "buildActivityId" TEXT,
    "backlogActivityId" TEXT,
    "capsuleActivityId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuntimeVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RuntimeTarget_targetId_key" ON "RuntimeTarget"("targetId");
CREATE INDEX "RuntimeTarget_kind_status_idx" ON "RuntimeTarget"("kind", "status");
CREATE INDEX "RuntimeTarget_workCapsuleId_idx" ON "RuntimeTarget"("workCapsuleId");
CREATE INDEX "RuntimeTarget_featureBuildId_idx" ON "RuntimeTarget"("featureBuildId");
CREATE INDEX "RuntimeTarget_sandboxId_idx" ON "RuntimeTarget"("sandboxId");
CREATE INDEX "RuntimeTarget_slotId_idx" ON "RuntimeTarget"("slotId");

CREATE UNIQUE INDEX "RuntimeVerification_verificationId_key" ON "RuntimeVerification"("verificationId");
CREATE INDEX "RuntimeVerification_runtimeTargetId_createdAt_idx" ON "RuntimeVerification"("runtimeTargetId", "createdAt" DESC);
CREATE INDEX "RuntimeVerification_featureBuildId_kind_status_idx" ON "RuntimeVerification"("featureBuildId", "kind", "status");
CREATE INDEX "RuntimeVerification_workCapsuleId_kind_status_idx" ON "RuntimeVerification"("workCapsuleId", "kind", "status");
CREATE INDEX "RuntimeVerification_kind_status_idx" ON "RuntimeVerification"("kind", "status");

ALTER TABLE "RuntimeTarget" ADD CONSTRAINT "RuntimeTarget_workCapsuleId_fkey"
    FOREIGN KEY ("workCapsuleId") REFERENCES "WorkCapsule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RuntimeTarget" ADD CONSTRAINT "RuntimeTarget_featureBuildId_fkey"
    FOREIGN KEY ("featureBuildId") REFERENCES "FeatureBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RuntimeTarget" ADD CONSTRAINT "RuntimeTarget_sandboxId_fkey"
    FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RuntimeTarget" ADD CONSTRAINT "RuntimeTarget_slotId_fkey"
    FOREIGN KEY ("slotId") REFERENCES "SandboxSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RuntimeVerification" ADD CONSTRAINT "RuntimeVerification_runtimeTargetId_fkey"
    FOREIGN KEY ("runtimeTargetId") REFERENCES "RuntimeTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RuntimeVerification" ADD CONSTRAINT "RuntimeVerification_workCapsuleId_fkey"
    FOREIGN KEY ("workCapsuleId") REFERENCES "WorkCapsule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RuntimeVerification" ADD CONSTRAINT "RuntimeVerification_featureBuildId_fkey"
    FOREIGN KEY ("featureBuildId") REFERENCES "FeatureBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RuntimeVerification" ADD CONSTRAINT "RuntimeVerification_gitPromotionCandidateId_fkey"
    FOREIGN KEY ("gitPromotionCandidateId") REFERENCES "GitPromotionCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
