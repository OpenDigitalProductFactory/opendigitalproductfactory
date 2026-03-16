-- CreateTable
CREATE TABLE "ImprovementProposal" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "submittedById" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "routeContext" TEXT NOT NULL,
    "threadId" TEXT,
    "conversationExcerpt" TEXT,
    "observedFriction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "prioritizedAt" TIMESTAMP(3),
    "backlogItemId" TEXT,
    "buildId" TEXT,
    "rejectionReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "contributionStatus" TEXT NOT NULL DEFAULT 'local',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImprovementProposal_proposalId_key" ON "ImprovementProposal"("proposalId");

-- CreateIndex
CREATE INDEX "ImprovementProposal_status_idx" ON "ImprovementProposal"("status");

-- CreateIndex
CREATE INDEX "ImprovementProposal_submittedById_idx" ON "ImprovementProposal"("submittedById");

-- CreateIndex
CREATE INDEX "ImprovementProposal_routeContext_idx" ON "ImprovementProposal"("routeContext");

-- AddForeignKey
ALTER TABLE "ImprovementProposal" ADD CONSTRAINT "ImprovementProposal_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementProposal" ADD CONSTRAINT "ImprovementProposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
