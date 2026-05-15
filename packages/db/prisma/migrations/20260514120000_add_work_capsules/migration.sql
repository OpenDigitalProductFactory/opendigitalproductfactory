-- CreateTable
CREATE TABLE "WorkCapsule" (
    "id" TEXT NOT NULL,
    "capsuleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL,
    "executorKind" TEXT,
    "executorRef" TEXT,
    "backlogItemId" TEXT,
    "epicId" TEXT,
    "featureBuildId" TEXT,
    "taskRunId" TEXT,
    "gitPromotionCandidateId" TEXT,
    "changePromotionId" TEXT,
    "repositoryFullName" TEXT,
    "baseBranch" TEXT,
    "baseSha" TEXT,
    "headBranch" TEXT,
    "headSha" TEXT,
    "worktreePath" TEXT,
    "pullRequestUrl" TEXT,
    "pullRequestNumber" INTEGER,
    "sandboxProviderId" TEXT,
    "sandboxId" TEXT,
    "scopeClaims" JSONB NOT NULL DEFAULT '[]',
    "workspaceState" JSONB NOT NULL DEFAULT '{}',
    "verificationState" JSONB NOT NULL DEFAULT '{}',
    "providerRequirements" JSONB NOT NULL DEFAULT '[]',
    "promotionPolicy" JSONB NOT NULL DEFAULT '{}',
    "contributionMode" TEXT NOT NULL DEFAULT 'private',
    "branchTaxonomy" TEXT,
    "idempotencyKey" TEXT,
    "leaseHolderPrincipalId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdByPrincipalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "WorkCapsule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCapsuleActivity" (
    "id" TEXT NOT NULL,
    "workCapsuleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "recordedByAgentId" TEXT,
    "toolExecutionId" TEXT,

    CONSTRAINT "WorkCapsuleActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkCapsule_capsuleId_key" ON "WorkCapsule"("capsuleId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCapsule_idempotencyKey_key" ON "WorkCapsule"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WorkCapsule_status_updatedAt_idx" ON "WorkCapsule"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkCapsule_backlogItemId_idx" ON "WorkCapsule"("backlogItemId");

-- CreateIndex
CREATE INDEX "WorkCapsule_featureBuildId_idx" ON "WorkCapsule"("featureBuildId");

-- CreateIndex
CREATE INDEX "WorkCapsule_taskRunId_idx" ON "WorkCapsule"("taskRunId");

-- CreateIndex
CREATE INDEX "WorkCapsule_gitPromotionCandidateId_idx" ON "WorkCapsule"("gitPromotionCandidateId");

-- CreateIndex
CREATE INDEX "WorkCapsule_changePromotionId_idx" ON "WorkCapsule"("changePromotionId");

-- CreateIndex
CREATE INDEX "WorkCapsule_epicId_idx" ON "WorkCapsule"("epicId");

-- CreateIndex
CREATE INDEX "WorkCapsule_headBranch_idx" ON "WorkCapsule"("headBranch");

-- CreateIndex
CREATE INDEX "WorkCapsule_sandboxId_idx" ON "WorkCapsule"("sandboxId");

-- CreateIndex
CREATE INDEX "WorkCapsule_leaseExpiresAt_idx" ON "WorkCapsule"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCapsule_repo_headBranch_active_key"
    ON "WorkCapsule"("repositoryFullName", "headBranch")
    WHERE "archivedAt" IS NULL;

-- CreateIndex
CREATE INDEX "WorkCapsuleActivity_workCapsuleId_recordedAt_idx" ON "WorkCapsuleActivity"("workCapsuleId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "WorkCapsuleActivity_kind_recordedAt_idx" ON "WorkCapsuleActivity"("kind", "recordedAt" DESC);

-- AddForeignKey
ALTER TABLE "WorkCapsuleActivity" ADD CONSTRAINT "WorkCapsuleActivity_workCapsuleId_fkey" FOREIGN KEY ("workCapsuleId") REFERENCES "WorkCapsule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
