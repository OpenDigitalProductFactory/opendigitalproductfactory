-- Call-level audit log for every enterprise-integration MCP tool invocation.
-- Reusable across ADP, QuickBooks, Plaid, Workday — the `integration` column discriminates.
-- argsHash is sha256 of canonicalized args (raw args never stored).
-- errorMessage is pre-redacted before insertion (secret material must never land here).

-- CreateTable
CREATE TABLE "IntegrationToolCallLog" (
    "id" TEXT NOT NULL,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "integration" TEXT NOT NULL,
    "coworkerId" TEXT NOT NULL,
    "userId" TEXT,
    "toolName" TEXT NOT NULL,
    "argsHash" TEXT NOT NULL,
    "responseKind" TEXT NOT NULL,
    "resultCount" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "IntegrationToolCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationToolCallLog_calledAt_idx" ON "IntegrationToolCallLog"("calledAt");

-- CreateIndex
CREATE INDEX "IntegrationToolCallLog_integration_calledAt_idx" ON "IntegrationToolCallLog"("integration", "calledAt");

-- CreateIndex
CREATE INDEX "IntegrationToolCallLog_coworkerId_calledAt_idx" ON "IntegrationToolCallLog"("coworkerId", "calledAt");

-- CreateIndex
CREATE INDEX "IntegrationToolCallLog_toolName_calledAt_idx" ON "IntegrationToolCallLog"("toolName", "calledAt");
