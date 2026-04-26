-- AlterTable
ALTER TABLE "ToolExecution" ADD COLUMN "apiTokenId" TEXT;

-- CreateIndex
CREATE INDEX "ToolExecution_apiTokenId_createdAt_idx" ON "ToolExecution"("apiTokenId", "createdAt" DESC);

-- CreateTable
CREATE TABLE "McpApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capability" TEXT NOT NULL DEFAULT 'read',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpApiToken_tokenHash_key" ON "McpApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "McpApiToken_userId_revokedAt_idx" ON "McpApiToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "McpApiToken_tokenHash_idx" ON "McpApiToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "McpApiToken" ADD CONSTRAINT "McpApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
