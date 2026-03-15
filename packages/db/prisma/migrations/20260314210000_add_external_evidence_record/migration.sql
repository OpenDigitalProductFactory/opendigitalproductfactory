-- CreateTable
CREATE TABLE "ExternalEvidenceRecord" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "routeContext" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "resultSummary" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalEvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalEvidenceRecord_actorUserId_createdAt_idx" ON "ExternalEvidenceRecord"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalEvidenceRecord_routeContext_operationType_idx" ON "ExternalEvidenceRecord"("routeContext", "operationType");

-- CreateIndex
CREATE INDEX "ExternalEvidenceRecord_operationType_createdAt_idx" ON "ExternalEvidenceRecord"("operationType", "createdAt");

-- AddForeignKey
ALTER TABLE "ExternalEvidenceRecord" ADD CONSTRAINT "ExternalEvidenceRecord_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
