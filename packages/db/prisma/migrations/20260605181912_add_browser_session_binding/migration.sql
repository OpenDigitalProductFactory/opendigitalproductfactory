
-- CreateTable
CREATE TABLE "BrowserSessionBinding" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "means" TEXT NOT NULL,
    "driverRef" TEXT,
    "engine" TEXT NOT NULL,
    "profileRef" TEXT NOT NULL,
    "profileKind" TEXT NOT NULL,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "actingPrincipalId" TEXT,
    "delegatingUserId" TEXT NOT NULL,
    "delegationGrantId" TEXT,
    "credentialId" TEXT,
    "targetDomains" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "meansDecisionJson" JSONB,
    "evidenceDir" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "BrowserSessionBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrowserSessionBinding_sessionId_key" ON "BrowserSessionBinding"("sessionId");

-- CreateIndex
CREATE INDEX "BrowserSessionBinding_actingPrincipalId_idx" ON "BrowserSessionBinding"("actingPrincipalId");

-- CreateIndex
CREATE INDEX "BrowserSessionBinding_delegatingUserId_idx" ON "BrowserSessionBinding"("delegatingUserId");

-- CreateIndex
CREATE INDEX "BrowserSessionBinding_status_idx" ON "BrowserSessionBinding"("status");

