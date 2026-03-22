-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "body" TEXT;

-- CreateTable
CREATE TABLE "AsyncInferenceOp" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "operationId" TEXT,
    "contractFamily" TEXT NOT NULL,
    "requestContext" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resultText" TEXT,
    "resultData" JSONB,
    "errorMessage" TEXT,
    "progressPct" INTEGER,
    "progressMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "threadId" TEXT,
    "callerContext" JSONB,

    CONSTRAINT "AsyncInferenceOp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AsyncInferenceOp_status_idx" ON "AsyncInferenceOp"("status");

-- CreateIndex
CREATE INDEX "AsyncInferenceOp_providerId_status_idx" ON "AsyncInferenceOp"("providerId", "status");

-- CreateIndex
CREATE INDEX "AsyncInferenceOp_threadId_idx" ON "AsyncInferenceOp"("threadId");
