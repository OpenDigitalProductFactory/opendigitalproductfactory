-- AlterTable
ALTER TABLE "McpServer" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "activatedBy" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "integrationId" TEXT,
ADD COLUMN     "lastHealthCheck" TIMESTAMP(3),
ADD COLUMN     "lastHealthError" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "transport" TEXT;

-- CreateTable
CREATE TABLE "McpServerTool" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "description" TEXT,
    "inputSchema" JSONB NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServerTool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "McpServerTool_serverId_idx" ON "McpServerTool"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "McpServerTool_serverId_toolName_key" ON "McpServerTool"("serverId", "toolName");

-- CreateIndex
CREATE INDEX "McpServer_status_idx" ON "McpServer"("status");

-- CreateIndex
CREATE INDEX "McpServer_category_idx" ON "McpServer"("category");

-- AddForeignKey
ALTER TABLE "McpServer" ADD CONSTRAINT "McpServer_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "McpIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpServerTool" ADD CONSTRAINT "McpServerTool_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
