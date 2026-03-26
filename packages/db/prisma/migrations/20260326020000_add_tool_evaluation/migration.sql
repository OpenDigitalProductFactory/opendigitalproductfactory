-- CreateTable
CREATE TABLE "ToolEvaluation" (
    "id" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "verdict" JSONB,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "findings" JSONB NOT NULL DEFAULT '[]',
    "reviewers" JSONB NOT NULL DEFAULT '[]',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reEvaluateAfter" TIMESTAMP(3),
    "supersedes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolEvaluation_pkey" PRIMARY KEY ("id")
);

-- AlterTable: AgentActionProposal
ALTER TABLE "AgentActionProposal" ADD COLUMN "toolEvaluationId" TEXT;

-- AlterTable: TaskEvaluation
ALTER TABLE "TaskEvaluation" ADD COLUMN "toolName" TEXT;

-- CreateIndex
CREATE INDEX "ToolEvaluation_toolName_status_idx" ON "ToolEvaluation"("toolName", "status");

-- CreateIndex
CREATE INDEX "ToolEvaluation_status_idx" ON "ToolEvaluation"("status");

-- CreateIndex
CREATE INDEX "ToolEvaluation_reEvaluateAfter_idx" ON "ToolEvaluation"("reEvaluateAfter");

-- AddForeignKey
ALTER TABLE "AgentActionProposal" ADD CONSTRAINT "AgentActionProposal_toolEvaluationId_fkey" FOREIGN KEY ("toolEvaluationId") REFERENCES "ToolEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
