-- Add optional Build Studio context links to external evidence records.
ALTER TABLE "ExternalEvidenceRecord" ADD COLUMN "buildId" TEXT;
ALTER TABLE "ExternalEvidenceRecord" ADD COLUMN "taskRunId" TEXT;

CREATE INDEX "ExternalEvidenceRecord_buildId_createdAt_idx" ON "ExternalEvidenceRecord"("buildId", "createdAt");
CREATE INDEX "ExternalEvidenceRecord_taskRunId_createdAt_idx" ON "ExternalEvidenceRecord"("taskRunId", "createdAt");
