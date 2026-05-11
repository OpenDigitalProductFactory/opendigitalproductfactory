CREATE TABLE "GitPromotionCandidate" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "deliveryKey" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "repositoryCloneUrl" TEXT,
    "ref" TEXT,
    "branch" TEXT,
    "beforeSha" TEXT,
    "afterSha" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "statusReason" TEXT,
    "sandboxProviderId" TEXT,
    "sandboxId" TEXT,
    "verificationStartedAt" TIMESTAMP(3),
    "verificationCompletedAt" TIMESTAMP(3),
    "verificationResult" JSONB,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitPromotionCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitPromotionCandidate_candidateId_key" ON "GitPromotionCandidate"("candidateId");
CREATE UNIQUE INDEX "GitPromotionCandidate_deliveryKey_key" ON "GitPromotionCandidate"("deliveryKey");
CREATE INDEX "GitPromotionCandidate_status_createdAt_idx" ON "GitPromotionCandidate"("status", "createdAt");
CREATE INDEX "GitPromotionCandidate_repositoryFullName_afterSha_idx" ON "GitPromotionCandidate"("repositoryFullName", "afterSha");
